import { afterAll, describe, expect, it } from "vitest";

import { getTask, getTasks } from "@/lib/data";
import { sql } from "@/lib/db";
import {
  loadComments,
  loadProjects,
  loadTasks,
  loadUsers,
} from "../../tests/fixtures/load";

// The workspace-wide task list and the task detail row, which
// spec/queries.md names "Task detail": one task plus its project, assignee and
// the 10 most recent comments.
//
// Both pages read the in-memory fixture today, so a write made through the
// actions is invisible on them until they read the database.

afterAll(async () => {
  await sql.end();
});

const fixtureTasks = loadTasks();
const fixtureUsers = loadUsers();
const fixtureProjects = loadProjects();
const fixtureComments = loadComments();

const userName = (id: number | null) =>
  fixtureUsers.find((u) => u.id === id)?.displayName ?? "";
const projectName = (id: number) =>
  fixtureProjects.find((p) => p.id === id)?.name ?? "";
const commentCountFor = (taskId: number) =>
  fixtureComments.filter((c) => c.taskId === taskId).length;

describe("getTasks", () => {
  it("returns every task in the workspace", async () => {
    const tasks = await getTasks();

    expect(tasks).toHaveLength(fixtureTasks.length);
  });

  it("returns tasks newest updated first", async () => {
    const tasks = await getTasks();

    const expected = [...fixtureTasks]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
      .map((t) => t.id);

    expect(tasks.map((t) => t.id)).toEqual(expected);
  });

  it("carries the project name each task belongs to", async () => {
    const tasks = await getTasks();

    for (const task of tasks) {
      const fixture = fixtureTasks.find((t) => t.id === task.id)!;

      expect(task.projectName).toBe(projectName(fixture.projectId));
    }
  });

  it("carries the fields the table renders", async () => {
    const tasks = await getTasks();
    const fixture = fixtureTasks.find((t) => t.id === 101)!;

    const task = tasks.find((t) => t.id === 101);

    expect(task?.title).toBe(fixture.title);
    expect(task?.description).toBe(fixture.description);
    expect(task?.status).toBe(fixture.status);
    expect(task?.assigneeName).toBe(userName(fixture.assigneeId));
    expect(task?.updatedAt).toBe(fixture.updatedAt);
    expect(task?.commentCount).toBe(commentCountFor(101));
  });

  it("renders an unassigned task rather than a null assignee", async () => {
    await sql`
      INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
      VALUES (1, NULL, 'Integration open task', '', 'todo', '2026-10-26T09:00:00Z', '2026-10-26T09:00:00Z')
    `;

    try {
      const tasks = await getTasks();

      expect(
        tasks.find((t) => t.title === "Integration open task")?.assigneeName,
      ).toBe("Unassigned");
    } finally {
      await sql`DELETE FROM tasks WHERE title = 'Integration open task'`;
    }
  });

  describe("filters", () => {
    it("narrows to one project", async () => {
      const tasks = await getTasks({ projectId: 2 });

      expect(tasks.map((t) => t.id).sort((a, b) => a - b)).toEqual([104, 105]);
    });

    it("narrows to one status", async () => {
      const tasks = await getTasks({ status: "in progress" });

      expect(tasks.map((t) => t.id)).toEqual([101, 105]);
    });

    it("narrows to one assignee", async () => {
      const tasks = await getTasks({ assigneeId: 1 });

      expect(tasks.map((t) => t.id)).toEqual([101, 105]);
    });

    it("combines filters rather than replacing them", async () => {
      const tasks = await getTasks({ projectId: 1, status: "todo" });

      expect(tasks.map((t) => t.id)).toEqual([102]);
    });

    it("matches the search term across title and description", async () => {
      const tasks = await getTasks({ search: "breakpoint" });

      expect(tasks.map((t) => t.id)).toEqual([102]);
    });

    it("returns nothing when a filter combination matches no task", async () => {
      // Project 3's only task is `todo`, so asking for `done` there is empty.
      expect(await getTasks({ projectId: 3, status: "done" })).toEqual([]);
    });

    it("treats wildcard characters in the search term as literals", async () => {
      expect(await getTasks({ search: "%" })).toEqual([]);
      expect(await getTasks({ search: "_" })).toEqual([]);
    });
  });

  describe("pagination", () => {
    it("caps the workspace list at 25 rows, per spec/queries.md", async () => {
      try {
        await sql.begin(async (tx) => {
          for (let i = 0; i < 30; i++) {
            await tx`
              INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
              VALUES (1, NULL, ${`Workspace bulk ${i}`}, '', 'todo', '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z')
            `;
          }
        });

        expect(await getTasks()).toHaveLength(25);
      } finally {
        await sql`DELETE FROM tasks WHERE title LIKE 'Workspace bulk %'`;
      }
    });
  });
});

describe("getTask", () => {
  it("returns the task with its project name and assignee", async () => {
    const fixture = fixtureTasks.find((t) => t.id === 101)!;

    const task = await getTask(101);

    expect(task?.title).toBe(fixture.title);
    expect(task?.description).toBe(fixture.description);
    expect(task?.status).toBe(fixture.status);
    expect(task?.projectId).toBe(1);
    expect(task?.projectName).toBe(projectName(1));
    expect(task?.assigneeName).toBe(userName(fixture.assigneeId));
    expect(task?.updatedAt).toBe(fixture.updatedAt);
  });

  it("agrees with the list row for the same task", async () => {
    // The detail page and the list each run a different query, so this catches
    // the two disagreeing about a field the list also shows.
    const fromList = (await getTasks()).find((t) => t.id === 104)!;
    const detail = await getTask(104);

    expect({ ...detail, commentCount: undefined }).toEqual({
      ...fromList,
      commentCount: undefined,
    });
  });

  it("returns null for an id that matches no task", async () => {
    expect(await getTask(999_999)).toBeNull();
  });

  it("returns null for a task deleted from the database", async () => {
    await sql`
      INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
      VALUES (1, NULL, 'Integration vanishing', '', 'todo', '2026-10-27T09:00:00Z', '2026-10-27T09:00:00Z')
    `;

    const [row] = await sql<{ id: number }[]>`
      SELECT id::int FROM tasks WHERE title = 'Integration vanishing'
    `;

    await sql`DELETE FROM tasks WHERE id = ${row.id}`;

    // Absence is the committed outcome of a delete (spec/contract.md).
    expect(await getTask(row.id)).toBeNull();
  });

  it("reflects a status change without needing a cache invalidation", async () => {
    const original = await sql<{ status: string }[]>`
      SELECT status FROM tasks WHERE id = 102
    `;

    await sql`UPDATE tasks SET status = 'done' WHERE id = 102`;

    try {
      expect((await getTask(102))?.status).toBe("done");
    } finally {
      await sql`UPDATE tasks SET status = ${original[0].status} WHERE id = 102`;
    }
  });
});
