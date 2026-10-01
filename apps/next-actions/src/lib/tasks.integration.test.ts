import { afterAll, describe, expect, it } from "vitest";

import { countTasks, getTask, getTasks } from "@/lib/data";
import { encodeCursor } from "@/lib/cursor";
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

    it("resumes after the cursor without repeating or skipping a row", async () => {
      // Walks one row at a time using each row's own cursor. The two failures a
      // keyset bug produces are a repeated row and a gap, and this catches both.
      const ordered = [...fixtureTasks]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
        .map((t) => t.id);

      const collected: number[] = [];
      let cursor: string | null = null;

      for (let guard = 0; guard < 12; guard++) {
        const page = await getTasks({ limit: 1, cursor });
        if (page.length === 0) break;

        collected.push(...page.map((t) => t.id));
        cursor = page[0].cursorFor;
      }

      expect(collected).toEqual(ordered);
    });

    it("gives rows sharing an updated_at distinct cursors", async () => {
      // Only the id tiebreaker separates them, so a cursor built without it
      // would make one row unreachable.
      const stamp = "2026-11-20T09:00:00Z";

      try {
        await sql.begin(async (tx) => {
          for (const title of ["List Twin A", "List Twin B"]) {
            await tx`
              INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
              VALUES (1, NULL, ${title}, '', 'todo', ${stamp}, ${stamp})
            `;
          }
        });

        const first = await getTasks({ limit: 1 });
        const next = await getTasks({ limit: 1, cursor: first[0].cursorFor });

        expect(first[0].title).toBe("List Twin B");
        expect(next.map((t) => t.title)).toEqual(["List Twin A"]);
      } finally {
        await sql`DELETE FROM tasks WHERE title LIKE 'List Twin %'`;
      }
    });

    it("is stable: the same cursor returns the same page", async () => {
      const fixture = [...fixtureTasks].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      )[1];
      const cursor = encodeCursor(
        `${fixture.updatedAt.replace("Z", ".000000Z")}`,
        fixture.id,
      );

      expect((await getTasks({ cursor, limit: 1 })).map((t) => t.id)).toEqual(
        (await getTasks({ cursor, limit: 1 })).map((t) => t.id),
      );
    });

    it("keeps the filters applied across a page boundary", async () => {
      try {
        await sql.begin(async (tx) => {
          for (let i = 0; i < 3; i++) {
            await tx`
              INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
              VALUES (2, 1, ${`Paged ${i}`}, '', 'todo', ${`2026-11-0${i + 1}T09:00:00Z`}, ${`2026-11-0${i + 1}T09:00:00Z`})
            `;
          }
        });

        const first = await getTasks({
          projectId: 2,
          status: "todo",
          limit: 2,
        });
        const second = await getTasks({
          projectId: 2,
          status: "todo",
          limit: 2,
          cursor: first.at(-1)!.cursorFor,
        });

        const ids = [...first, ...second].map((t) => t.id);

        expect(new Set(ids).size).toBe(ids.length);

        // Read the constraint off the row rather than the fixture: the three
        // inserted rows are not in it.
        for (const row of [...first, ...second]) {
          expect(row.projectId).toBe(2);
          expect(row.status).toBe("todo");
          expect(row.title.startsWith("Paged ") || row.id === 104).toBe(true);
        }
      } finally {
        await sql`DELETE FROM tasks WHERE title LIKE 'Paged %'`;
      }
    });

    it("returns nothing for a cursor past the oldest row", async () => {
      const oldest = [...fixtureTasks].sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt),
      )[0];
      const cursor = encodeCursor(
        `${oldest.updatedAt.replace("Z", ".000000Z")}`,
        oldest.id,
      );

      expect(await getTasks({ cursor })).toEqual([]);
    });

    it("falls back to the first page when the cursor is unusable", async () => {
      const tasks = await getTasks({ cursor: "garbage" });

      expect(tasks[0].id).toBe(
        [...fixtureTasks].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        )[0].id,
      );
    });
  });
});

describe("countTasks", () => {
  it("counts every task when nothing is filtered", async () => {
    expect(await countTasks()).toBe(fixtureTasks.length);
  });

  it("applies the same filters as getTasks", async () => {
    // The summary line the list renders reads this, so a mismatch here would
    // show "Showing 1-2 of 6" for a two-row page.
    const cases = [
      { projectId: 1 },
      { projectId: 2, status: "todo" },
      { status: "in progress" },
      { assigneeId: 1 },
      { search: "breakpoint" },
    ];

    for (const filters of cases) {
      const rows = await getTasks({ ...filters, limit: 100 });
      expect(await countTasks(filters)).toBe(rows.length);
    }
  });

  it("counts zero when a filter combination matches nothing", async () => {
    expect(await countTasks({ projectId: 3, status: "done" })).toBe(0);
  });

  it("counts a task created after the page was first rendered", async () => {
    const before = await countTasks();

    await sql`
      INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
      VALUES (1, NULL, 'Integration counted task', '', 'todo', '2026-10-29T09:00:00Z', '2026-10-29T09:00:00Z')
    `;

    try {
      expect(await countTasks()).toBe(before + 1);
    } finally {
      await sql`DELETE FROM tasks WHERE title = 'Integration counted task'`;
    }
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
    // the two disagreeing about a field both display. Compared field by field
    // rather than as whole objects: a list row additionally carries the keyset
    // cursor, which is paging state and not something the detail page shows.
    const fromList = (await getTasks()).find((t) => t.id === 104)!;
    const detail = await getTask(104);

    for (const key of Object.keys(detail!) as (keyof typeof detail)[]) {
      expect(detail![key], `field ${key} differs`).toBe(fromList[key]);
    }
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
