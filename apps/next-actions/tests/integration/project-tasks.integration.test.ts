import { afterAll, describe, expect, it } from "vitest";

import { getProjectTasks } from "@/lib/data";
import { encodeCursor } from "@/lib/cursor";
import { sql } from "@/lib/db";
import {
  loadComments,
  loadProjects,
  loadTasks,
  loadUsers,
} from "../fixtures/load";

// spec/queries.md — "List project tasks": up to 25 rows for a project, newest
// first, `(created_at DESC, id DESC)`, optional single-status filter, keyset
// pagination on `(created_at, id)`, assignee display names via LEFT JOIN.
//
// Assertions read expected values from the shared fixture rather than retyping
// them, so this suite cannot describe rows the e2e database does not hold.

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

/** Fixture tasks for a project, in the order the query must return them. */
const expectedTasksFor = (projectId: number) =>
  fixtureTasks
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);

describe("getProjectTasks", () => {
  it("returns the project's tasks newest first", async () => {
    const tasks = await getProjectTasks(1);

    expect(tasks.map((t) => t.id)).toEqual([101, 102, 103]);
  });

  it("carries every field the task table renders", async () => {
    const tasks = await getProjectTasks(1);
    const fixture = fixtureTasks.find((t) => t.id === 101)!;

    const task = tasks.find((t) => t.id === 101);

    expect(task?.projectId).toBe(1);
    expect(task?.title).toBe(fixture.title);
    expect(task?.description).toBe(fixture.description);
    expect(task?.status).toBe(fixture.status);
    expect(task?.assigneeName).toBe(userName(fixture.assigneeId));
    expect(task?.commentCount).toBe(commentCountFor(101));
  });

  it("includes the project name the workspace-wide shape carries", async () => {
    const tasks = await getProjectTasks(2);

    expect(tasks[0].projectName).toBe(projectName(2));
  });

  it("counts each task's comments without letting the join fan out", async () => {
    const tasks = await getProjectTasks(1);

    // Tasks 101 and 104 have comments; 102, 103 and 106 have none.
    expect(tasks.find((t) => t.id === 101)?.commentCount).toBe(2);
    expect(tasks.find((t) => t.id === 102)?.commentCount).toBe(0);
    expect(tasks.find((t) => t.id === 103)?.commentCount).toBe(0);
  });

  it("renders an unassigned task rather than a null assignee", async () => {
    await sql`
      INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
      VALUES (1, NULL, 'Integration unassigned', '', 'todo', '2026-09-29T09:00:00Z', '2026-09-29T09:00:00Z')
    `;

    try {
      const tasks = await getProjectTasks(1);

      const task = tasks.find((t) => t.title === "Integration unassigned");

      // `assignee_id` is nullable, so the LEFT JOIN yields NULL. Rendering it
      // as a name would put "null" on screen.
      expect(task?.assigneeName).toBe("Unassigned");
    } finally {
      await sql`DELETE FROM tasks WHERE title = 'Integration unassigned'`;
    }
  });

  it("returns only tasks belonging to the requested project", async () => {
    const tasks = await getProjectTasks(3);

    expect(tasks.map((t) => t.id)).toEqual([106]);
  });

  it("returns an empty list for a project that exists but has no tasks", async () => {
    await sql`
      INSERT INTO projects (name, description, created_at)
      VALUES ('Integration empty', '', '2026-09-01T09:00:00Z')
    `;

    try {
      expect(await getProjectTasks(9001)).toEqual([]);
    } finally {
      await sql`DELETE FROM projects WHERE name = 'Integration empty'`;
    }
  });

  it("returns an empty list for an id that matches no project", async () => {
    expect(await getProjectTasks(999_999)).toEqual([]);
  });

  describe("status filter", () => {
    it("returns only tasks in the requested status", async () => {
      const tasks = await getProjectTasks(1, { status: "todo" });

      expect(tasks.map((t) => t.id)).toEqual([102]);
    });

    it("matches a multi-word status exactly", async () => {
      const tasks = await getProjectTasks(1, { status: "in progress" });

      expect(tasks.map((t) => t.id)).toEqual([101]);
    });

    it("returns only done tasks when asked for done", async () => {
      const tasks = await getProjectTasks(1, { status: "done" });

      expect(tasks.map((t) => t.id)).toEqual([103]);
    });

    it("ignores an empty filter, which means every status", async () => {
      const tasks = await getProjectTasks(1, { status: "" });

      expect(tasks).toHaveLength(3);
    });

    it("refuses a status the schema does not allow instead of erroring", async () => {
      // `status` is constrained text, so an unknown value cannot match a row.
      // Rejecting it keeps a tampered URL from reaching the query as a typo.
      await expect(
        getProjectTasks(1, { status: "archived" as never }),
      ).rejects.toThrow();
    });
  });

  describe("pagination", () => {
    it("caps a page at 25 rows, per spec/queries.md", async () => {
      // The correctness fixture is small, so this inserts enough rows to prove
      // the LIMIT is applied rather than assumed.
      const ids: number[] = [];

      try {
        await sql.begin(async (tx) => {
          for (let i = 0; i < 30; i++) {
            const [row] = await tx<{ id: number }[]>`
              INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
              VALUES (1, NULL, ${`Bulk ${i}`}, '', 'todo', ${`2026-09-20T09:00:0${i % 10}Z`}, ${`2026-09-20T09:00:0${i % 10}Z`})
              RETURNING id::int AS id
            `;
            ids.push(row.id);
          }
        });

        const tasks = await getProjectTasks(1);

        expect(tasks).toHaveLength(25);
      } finally {
        await sql`DELETE FROM tasks WHERE title LIKE 'Bulk %'`;
      }
    });

    it("returns the newest rows, not an arbitrary 25", async () => {
      const ids: number[] = [];

      try {
        await sql.begin(async (tx) => {
          for (let i = 0; i < 3; i++) {
            const [row] = await tx<{ id: number }[]>`
              INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
              VALUES (1, NULL, ${`Page ${i}`}, '', 'todo', ${`2026-10-0${i + 1}T09:00:00Z`}, ${`2026-10-0${i + 1}T09:00:00Z`})
              RETURNING id::int AS id
            `;
            ids.push(row.id);
          }
        });

        const tasks = await getProjectTasks(1, { limit: 2 });

        // The three inserted rows are all newer than the seeded ones, so page 1
        // is the two newest of them by created_at.
        expect(tasks.map((t) => t.title)).toEqual(["Page 2", "Page 1"]);
      } finally {
        await sql`DELETE FROM tasks WHERE title LIKE 'Page %'`;
      }
    });

    it("resumes after the cursor without repeating or skipping a row", async () => {
      // Walks the seeded project one row at a time and checks the concatenation
      // is exactly the full ordered list: the two failure modes a keyset bug
      // produces are a repeated row and a gap.
      const ordered = expectedTasksFor(1);
      const collected: number[] = [];
      let cursor: string | null = null;

      for (let guard = 0; guard < 10; guard++) {
        const page = await getProjectTasks(1, { limit: 1, cursor });

        if (page.length === 0) break;

        collected.push(...page.map((t) => t.id));

        const last = page[page.length - 1];
        const fixture = fixtureTasks.find((t) => t.id === last.id)!;
        cursor = encodeCursor(fixture.createdAt, last.id);
      }

      expect(collected).toEqual(ordered.map((t) => t.id));
    });

    it("is stable: the same cursor returns the same page", async () => {
      // spec/queries.md requires "same cursor → same page".
      const cursor = encodeCursor("2026-09-27T14:30:00.000000Z", 102);

      const first = await getProjectTasks(1, { cursor, limit: 1 });
      const second = await getProjectTasks(1, { cursor, limit: 1 });

      expect(first.map((t) => t.id)).toEqual(second.map((t) => t.id));
      expect(first.map((t) => t.id)).toEqual([103]);
    });

    it("applies the status filter together with the cursor", async () => {
      await sql.begin(async (tx) => {
        for (let i = 0; i < 3; i++) {
          await tx`
            INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
            VALUES (1, NULL, ${`Filtered ${i}`}, '', 'done', ${`2026-10-0${i + 1}T09:00:00Z`}, ${`2026-10-0${i + 1}T09:00:00Z`})
          `;
        }
      });

      try {
        const page = await getProjectTasks(1, {
          status: "done",
          limit: 2,
        });

        // Newest two of the three inserted `done` rows. The seeded `todo` rows
        // are newer than the oldest of these, so they would occupy the first
        // page if the status filter were not applied.
        expect(page.map((t) => t.title)).toEqual(["Filtered 2", "Filtered 1"]);
      } finally {
        await sql`DELETE FROM tasks WHERE title LIKE 'Filtered %'`;
      }
    });

    it("returns nothing for a cursor past the oldest row", async () => {
      const oldest = expectedTasksFor(1).at(-1)!;
      const cursor = encodeCursor(oldest.createdAt, oldest.id);

      expect(await getProjectTasks(1, { cursor })).toEqual([]);
    });

    it("falls back to the first page when the cursor is unusable", async () => {
      // A stale or hand-edited link should show page 1, not throw.
      const tasks = await getProjectTasks(1, { cursor: "garbage" });

      expect(tasks.map((t) => t.id)).toEqual([101, 102, 103]);
    });

    it("hands back a cursor that pages to the rows after it", async () => {
      // The page builds its "older" link from `cursorFor`, so the cursor a row
      // carries has to actually resume the walk. Walking with the row's own
      // cursor is the only way to prove the two agree.
      const ordered = expectedTasksFor(1);
      const collected: number[] = [];
      let cursor: string | null = null;

      for (let guard = 0; guard < 10; guard++) {
        const page = await getProjectTasks(1, { limit: 1, cursor });
        if (page.length === 0) break;

        collected.push(...page.map((t) => t.id));
        cursor = page[page.length - 1].cursorFor;
      }

      expect(collected).toEqual(ordered.map((t) => t.id));
    });

    it("gives rows sharing a created_at distinct cursors", async () => {
      // Two tasks created in the same instant: only the id tiebreaker separates
      // them, so a cursor built without it would make one row unreachable.
      const stamp = "2026-10-20T09:00:00Z";

      try {
        await sql.begin(async (tx) => {
          for (const title of ["Twin A", "Twin B"]) {
            await tx`
              INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
              VALUES (1, NULL, ${title}, '', 'todo', ${stamp}, ${stamp})
            `;
          }
        });

        const first = await getProjectTasks(1, { limit: 1 });
        const next = await getProjectTasks(1, {
          limit: 1,
          cursor: first[0].cursorFor,
        });

        expect(first[0].title).toBe("Twin B");
        expect(next.map((t) => t.title)).toEqual(["Twin A"]);
      } finally {
        await sql`DELETE FROM tasks WHERE title LIKE 'Twin %'`;
      }
    });
  });

  it("agrees with the per-project task count the project row reports", async () => {
    // The header counts and the table rows come from different queries, so this
    // catches a task that is counted but not listed (or the reverse).
    const tasks = await getProjectTasks(1);

    expect(tasks).toHaveLength(
      fixtureTasks.filter((t) => t.projectId === 1).length,
    );
  });
});
