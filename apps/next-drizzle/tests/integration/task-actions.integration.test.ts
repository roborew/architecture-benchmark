import { afterAll, describe, expect, it } from "vitest";

import {
  createTask,
  createTaskWithComment,
  deleteTask,
  updateTask,
  type State,
} from "@/lib/actions";
import { getTask, getTasks } from "@/lib/data";
import { sql } from "../e2e/query";

// spec/queries.md fixes the task write semantics: create sets created_at and
// updated_at explicitly and equal, update must set updated_at in the statement
// (not by DB default or ORM side effect), and create-with-comment is one
// transaction where any failure rolls back both rows.

afterAll(async () => {
  await sql.end();
});

function form(fields: Record<string, string>) {
  const data = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    data.append(key, value);
  }

  return data;
}

/**
 * Runs an action expected to succeed. A successful mutation ends in
 * `revalidatePath` + `redirect`, which throw outside a Next request context;
 * either way the row is committed, which is what each test then reads back.
 */
async function run(action: Promise<State>): Promise<void> {
  try {
    await action;
  } catch {
    // Expected: the action unwound after writing.
  }
}

/** Creates a task and returns its id, looked up by title rather than assumed. */
async function makeTask(
  title: string,
  fields: Record<string, string> = {},
): Promise<number> {
  const before = (await sql<{ id: number }[]>`SELECT id::int FROM tasks`).map(
    (r) => r.id,
  );

  await run(
    createTask(
      {},
      form({
        title,
        projectId: "1",
        assigneeId: "",
        status: "todo",
        ...fields,
      }),
    ),
  );

  // Found by diffing ids rather than by title: a test may pass an untrimmed
  // title, and the server stores the trimmed value.
  const [row] = await sql<{ id: number }[]>`
    SELECT id::int FROM tasks
    WHERE NOT (id = ANY(${before}::bigint[]))
    ORDER BY id DESC
    LIMIT 1
  `;

  expect(row, `could not create ${title}`).toBeDefined();

  return row.id;
}

describe("createTask", () => {
  it("inserts a task the read layer returns", async () => {
    const before = await getTasks();

    const id = await makeTask("Integration created task", {
      description: "Written by the integration suite.",
      assigneeId: "2",
    });

    const task = await getTask(id);

    expect(task?.title).toBe("Integration created task");
    expect(task?.description).toBe("Written by the integration suite.");
    expect(task?.projectId).toBe(1);
    expect(task?.projectName).toBe("Website redesign");
    expect(task?.status).toBe("todo");
    expect(task?.assigneeName).toBe("Alex Morgan");

    expect(await getTasks({ limit: 100 })).toHaveLength(before.length + 1);

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("creates an unassigned task when no assignee is chosen", async () => {
    // `assignee_id` is nullable and the form has an explicit empty option, so
    // an empty value is meaningful rather than invalid.
    const id = await makeTask("Integration no assignee");

    const [row] = await sql<{ assignee_id: number | null }[]>`
      SELECT assignee_id FROM tasks WHERE id = ${id}
    `;

    expect(row?.assignee_id).toBeNull();
    expect((await getTask(id))?.assigneeName).toBe("Unassigned");

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("sets created_at and updated_at explicitly, and to the same instant", async () => {
    // Both columns are NOT NULL with no default, so the server must supply them.
    const id = await makeTask("Integration timestamps");

    const [row] = await sql<{ created_at: Date; updated_at: Date }[]>`
      SELECT created_at, updated_at FROM tasks WHERE id = ${id}
    `;

    expect(row?.created_at).toBeInstanceOf(Date);
    expect(row?.updated_at).toBeInstanceOf(Date);
    expect(row?.created_at.getTime()).toBe(row?.updated_at.getTime());

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("allocates an id beyond the seeded rows", async () => {
    // The fixture carries explicit ids and advances the identity sequences, so
    // a live insert that collided would throw instead of returning a row.
    const id = await makeTask("Integration identity");

    expect(id).toBeGreaterThan(106);

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("rejects a blank title without inserting", async () => {
    const before = await getTasks({ limit: 100 });

    const state = await createTask(
      {},
      form({ title: "   ", projectId: "1", assigneeId: "", status: "todo" }),
    );

    expect(state.errors?.title?.[0]).toBe("Title is required.");
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("rejects a title over 200 characters, matching the schema CHECK", async () => {
    const before = await getTasks({ limit: 100 });

    const state = await createTask(
      {},
      form({
        title: "x".repeat(201),
        projectId: "1",
        assigneeId: "",
        status: "todo",
      }),
    );

    expect(state.errors?.title?.[0]).toContain("200 characters or fewer");
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("rejects a status the schema does not allow", async () => {
    const before = await getTasks({ limit: 100 });

    const state = await createTask(
      {},
      form({
        title: "Integration bad status",
        projectId: "1",
        assigneeId: "",
        status: "archived",
      }),
    );

    expect(state.errors?.status?.[0]).toBeDefined();
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("rejects a project that does not exist", async () => {
    const before = await getTasks({ limit: 100 });

    const state = await createTask(
      {},
      form({
        title: "Integration bad project",
        projectId: "999999",
        assigneeId: "",
        status: "todo",
      }),
    );

    expect(state.errors?.projectId?.[0]).toBeDefined();
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("requires a project, because the column is NOT NULL", async () => {
    const state = await createTask(
      {},
      form({ title: "Integration no project", projectId: "", status: "todo" }),
    );

    expect(state.errors?.projectId?.[0]).toBeDefined();
  });

  it("trims the title and description", async () => {
    const id = await makeTask("  Integration trimmed  ", {
      description: "  padded  ",
    });

    const task = await getTask(id);

    expect(task?.title).toBe("Integration trimmed");
    expect(task?.description).toBe("padded");

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("defaults an empty description to an empty string", async () => {
    const id = await makeTask("Integration bare");

    expect((await getTask(id))?.description).toBe("");

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });
});

describe("updateTask", () => {
  it("updates the intended row and nothing else", async () => {
    const id = await makeTask("Integration to edit", {
      assigneeId: "1",
    });

    await expect(
      updateTask(
        id,
        {},
        form({
          title: "Integration edited",
          description: "After",
          status: "done",
          assigneeId: "3",
        }),
      ),
    ).rejects.toThrow();

    const task = await getTask(id);
    expect(task?.title).toBe("Integration edited");
    expect(task?.description).toBe("After");
    expect(task?.status).toBe("done");
    expect(task?.assigneeName).toBe("Sam Taylor");

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("clears the assignee when the unassigned option is chosen", async () => {
    // spec/contract.md: exactly one way to unassign, an explicit choice.
    const id = await makeTask("Integration to unassign", { assigneeId: "1" });

    await expect(
      updateTask(
        id,
        {},
        form({
          title: "Integration to unassign",
          description: "",
          status: "todo",
          assigneeId: "",
        }),
      ),
    ).rejects.toThrow();

    const [row] = await sql<{ assignee_id: number | null }[]>`
      SELECT assignee_id FROM tasks WHERE id = ${id}
    `;

    expect(row?.assignee_id).toBeNull();

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("advances updated_at explicitly, and leaves created_at alone", async () => {
    // spec/queries.md is emphatic that the statement sets updated_at.
    const id = await makeTask("Integration timestamped");

    const [before] = await sql<{ created_at: Date; updated_at: Date }[]>`
      SELECT created_at, updated_at FROM tasks WHERE id = ${id}
    `;

    // Postgres timestamptz has microsecond resolution; a same-millisecond
    // update would make the comparison meaningless.
    await sql`SELECT pg_sleep(0.05)`;

    await expect(
      updateTask(
        id,
        {},
        form({
          title: "Integration timestamped",
          description: "",
          status: "in progress",
          assigneeId: "",
        }),
      ),
    ).rejects.toThrow();

    const [after] = await sql<{ created_at: Date; updated_at: Date }[]>`
      SELECT created_at, updated_at FROM tasks WHERE id = ${id}
    `;

    expect(after!.updated_at.getTime()).toBeGreaterThan(
      before!.updated_at.getTime(),
    );
    expect(after!.created_at.getTime()).toBe(before!.created_at.getTime());

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("reorders the workspace list, because it is ordered by updated_at", async () => {
    const id = await makeTask("Integration reorder");

    try {
      // Backdate the row so it sits at the end of the newest-first list.
      await sql`
        UPDATE tasks SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ${id}
      `;

      expect((await getTasks({ limit: 100 })).at(-1)?.id).toBe(id);

      await expect(
        updateTask(
          id,
          {},
          form({
            title: "Integration reorder",
            description: "",
            status: "todo",
            assigneeId: "",
          }),
        ),
      ).rejects.toThrow();

      // A fresh update_at floats the row to the top.
      expect((await getTasks({ limit: 100 }))[0]?.id).toBe(id);
    } finally {
      await sql`DELETE FROM tasks WHERE id = ${id}`;
    }
  });

  it("reports a blank title and changes nothing", async () => {
    const id = await makeTask("Integration reject edit");

    const state = await updateTask(
      id,
      {},
      form({
        title: "  ",
        description: "changed",
        status: "todo",
        assigneeId: "",
      }),
    );

    expect(state.errors?.title?.[0]).toBe("Title is required.");
    expect((await getTask(id))?.title).toBe("Integration reject edit");

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const state = await updateTask(
      999_999,
      {},
      form({ title: "Ghost", description: "", status: "todo", assigneeId: "" }),
    );

    expect(state.message).toBe("That task no longer exists.");
  });
});

describe("deleteTask", () => {
  it("removes a task so it is absent from the list", async () => {
    const id = await makeTask("Integration to delete");

    await expect(deleteTask(id, {}, new FormData())).rejects.toThrow();

    expect(await getTask(id)).toBeNull();
    expect((await getTasks({ limit: 100 })).map((t) => t.id)).not.toContain(id);
  });

  it("cascades the task's comments", async () => {
    // `comments.task_id` is ON DELETE CASCADE (spec/schema.sql), so orphaned
    // comments would otherwise survive their parent.
    const id = await makeTask("Integration with comments");

    await sql`
      INSERT INTO comments (task_id, author_id, body, created_at)
      VALUES (${id}, 1, 'Integration comment', '2026-10-28T09:00:00Z')
    `;

    const [{ count: before }] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM comments WHERE task_id = ${id}
    `;
    expect(before).toBe(1);

    await expect(deleteTask(id, {}, new FormData())).rejects.toThrow();

    const [{ count: after }] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM comments WHERE task_id = ${id}
    `;

    expect(after).toBe(0);
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const state = await deleteTask(999_999, {}, new FormData());

    expect(state.message).toBe("That task no longer exists.");
  });
});

describe("createTaskWithComment", () => {
  it("creates the task and its first comment together", async () => {
    const before = await getTasks({ limit: 100 });

    await run(
      createTaskWithComment(
        {},
        form({
          title: "Integration with first comment",
          description: "",
          projectId: "1",
          assigneeId: "",
          status: "todo",
          commentBody: "The opening note.",
          commentAuthorId: "1",
        }),
      ),
    );

    const [row] = await sql<{ id: number }[]>`
      SELECT id::int FROM tasks WHERE title = 'Integration with first comment'
    `;

    expect(row).toBeDefined();
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length + 1);

    const comments = await sql<{ body: string }[]>`
      SELECT body FROM comments WHERE task_id = ${row.id}
    `;

    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("The opening note.");

    await sql`DELETE FROM tasks WHERE id = ${row.id}`;
  });

  it("stores both timestamps on the task, as a plain create does", async () => {
    await run(
      createTaskWithComment(
        {},
        form({
          title: "Integration atomic timestamps",
          description: "",
          projectId: "1",
          assigneeId: "",
          status: "todo",
          commentBody: "A note.",
          commentAuthorId: "2",
        }),
      ),
    );

    const [row] = await sql<
      {
        id: number;
        created_at: Date;
        updated_at: Date;
      }[]
    >`
      SELECT id::int, created_at, updated_at
      FROM tasks WHERE title = 'Integration atomic timestamps'
    `;

    expect(row?.created_at).toBeInstanceOf(Date);
    expect(row?.created_at.getTime()).toBe(row?.updated_at.getTime());

    await sql`DELETE FROM tasks WHERE id = ${row!.id}`;
  });

  it("creates neither row when the comment author does not exist", async () => {
    // The atomicity requirement (spec/queries.md): a failure anywhere rolls back
    // both, so a task can never exist without the comment it was created with.
    const before = await getTasks({ limit: 100 });

    const state = await createTaskWithComment(
      {},
      form({
        title: "Integration rolled back",
        description: "",
        projectId: "1",
        assigneeId: "",
        status: "todo",
        commentBody: "Should not persist.",
        commentAuthorId: "999999",
      }),
    );

    expect(state.message).toBeDefined();
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);

    const [task] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM tasks WHERE title = 'Integration rolled back'
    `;

    expect(task?.count).toBe(0);
  });

  it("creates neither row when the comment body is blank", async () => {
    const before = await getTasks({ limit: 100 });

    const state = await createTaskWithComment(
      {},
      form({
        title: "Integration blank comment",
        description: "",
        projectId: "1",
        assigneeId: "",
        status: "todo",
        commentBody: "   ",
        commentAuthorId: "1",
      }),
    );

    expect(state.errors?.commentBody?.[0]).toBeDefined();
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);

    const [row] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM tasks WHERE title = 'Integration blank comment'
    `;

    expect(row?.count).toBe(0);
  });

  it("rejects a comment body over the 1000-character bound", async () => {
    const state = await createTaskWithComment(
      {},
      form({
        title: "Integration long comment",
        description: "",
        projectId: "1",
        assigneeId: "",
        status: "todo",
        commentBody: "x".repeat(1001),
        commentAuthorId: "1",
      }),
    );

    expect(state.errors?.commentBody?.[0]).toContain(
      "1000 characters or fewer",
    );
  });

  it("sets the comment's created_at explicitly", async () => {
    await run(
      createTaskWithComment(
        {},
        form({
          title: "Integration comment time",
          description: "",
          projectId: "1",
          assigneeId: "",
          status: "todo",
          commentBody: "Timed note.",
          commentAuthorId: "1",
        }),
      ),
    );

    const [row] = await sql<{ id: number }[]>`
      SELECT id::int FROM tasks WHERE title = 'Integration comment time'
    `;
    const [comment] = await sql<{ created_at: Date }[]>`
      SELECT created_at FROM comments WHERE task_id = ${row.id}
    `;

    expect(comment?.created_at).toBeInstanceOf(Date);

    await sql`DELETE FROM tasks WHERE id = ${row.id}`;
  });
});
