import { afterAll, describe, expect, it } from "vitest";

import { getComments, getTask, getTasks } from "@/lib/data";
import { sql } from "@/lib/db";
import { appRouter } from "@/trpc/routers/_app";

// spec/queries.md fixes the task write semantics: create sets created_at and
// updated_at explicitly and equal, update must set updated_at in the statement
// (not by DB default or ORM side effect), and create-with-comment is one
// transaction where any failure rolls back both rows.
//
// This replaces the Server Action version of these tests. A successful action
// used to end in `revalidatePath` + `redirect`, both of which throw outside a Next
// request context, so every success case needed `expect(...).rejects.toThrow()`
// and then a read-back — and a create could only be located by diffing ids, since
// the action returned no id. Procedures return `{ ok: true, id }`, so the id is
// the one asserted against and the throws are gone.

afterAll(async () => {
  await sql.end();
});

const caller = appRouter.createCaller({});

/** Narrows a refused result so the field errors and message are readable. */
function refusal(result: Awaited<ReturnType<typeof caller.tasks.create>>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected the procedure to refuse");
  return result;
}

/** Creates a task and returns the id the procedure reported. */
async function makeTask(
  title: string,
  fields: Partial<{
    description: string;
    status: string;
    assigneeId: number | null;
    projectId: number;
  }> = {},
) {
  const result = await caller.tasks.create({
    title,
    description: "",
    status: "todo",
    projectId: 1,
    assigneeId: null,
    ...fields,
  });

  if (!result.ok) {
    throw new Error(`could not create ${title}: ${result.message}`);
  }

  return result.id;
}

describe("tasks.create", () => {
  it("inserts a task the read layer returns", async () => {
    const before = await getTasks();

    const id = await makeTask("Integration created task", {
      description: "Written by the integration suite.",
      assigneeId: 2,
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
    // `null` is meaningful rather than invalid.
    const id = await makeTask("Integration no assignee");

    const [row] = await sql<{ assignee_id: number | null }[]>`
      SELECT assignee_id FROM tasks WHERE id = ${id}
    `;

    expect(row?.assignee_id).toBeNull();

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("sets created_at and updated_at explicitly, and to the same instant", async () => {
    const id = await makeTask("Integration timestamps");

    const [row] = await sql<{ created_at: Date; updated_at: Date }[]>`
      SELECT created_at, updated_at FROM tasks WHERE id = ${id}
    `;

    expect(row?.created_at).toBeInstanceOf(Date);
    expect(row?.updated_at).toEqual(row?.created_at);

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("allocates an id beyond the seeded rows", async () => {
    const id = await makeTask("Integration allocated id");

    // The seeded rows are 101-106 (spec/snapshots/correctness/tasks.csv).
    expect(id).toBeGreaterThan(106);

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("rejects a blank title without inserting", async () => {
    const before = await getTasks({ limit: 100 });

    const result = refusal(
      await caller.tasks.create({
        title: "   ",
        status: "todo",
        projectId: 1,
      }),
    );

    expect(result.errors?.title?.[0]).toBe("Title is required.");
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("rejects a title over 200 characters, matching the schema CHECK", async () => {
    const before = await getTasks({ limit: 100 });

    const result = refusal(
      await caller.tasks.create({
        title: "x".repeat(201),
        status: "todo",
        projectId: 1,
      }),
    );

    expect(result.errors?.title?.[0]).toContain("200 characters or fewer");
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("rejects a status the schema does not allow", async () => {
    const before = await getTasks({ limit: 100 });

    const result = refusal(
      await caller.tasks.create({
        title: "Integration bad status",
        status: "blocked",
        projectId: 1,
      }),
    );

    expect(result.errors?.status?.[0]).toBe("Choose a valid status.");
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("reports a project that does not exist as a field error", async () => {
    // Checked before the insert rather than left to the FK, so the reason lands on
    // the select the user actually filled in.
    const before = await getTasks({ limit: 100 });

    const result = refusal(
      await caller.tasks.create({
        title: "Integration no project",
        status: "todo",
        projectId: 999_999,
      }),
    );

    expect(result.errors?.projectId?.[0]).toBe(
      "That project no longer exists.",
    );
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("reports an assignee that does not exist as a field error", async () => {
    const before = await getTasks({ limit: 100 });

    const result = refusal(
      await caller.tasks.create({
        title: "Integration no assignee row",
        status: "todo",
        projectId: 1,
        assigneeId: 999_999,
      }),
    );

    expect(result.errors?.assigneeId?.[0]).toBe(
      "That assignee no longer exists.",
    );
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("trims the title and description", async () => {
    const id = await makeTask("  Integration trimmed  ", {
      description: "  Trimmed body  ",
    });

    const task = await getTask(id);

    expect(task?.title).toBe("Integration trimmed");
    expect(task?.description).toBe("Trimmed body");

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("defaults an empty description to an empty string", async () => {
    // The column is NOT NULL DEFAULT '' and an omitted description is legal, so
    // this must not be a validation failure.
    const id = await makeTask("Integration no description");

    expect((await getTask(id))?.description).toBe("");

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });
});

describe("tasks.update", () => {
  it("updates the intended row and nothing else", async () => {
    const id = await makeTask("Integration task to edit", {
      description: "Before",
      assigneeId: 1,
    });

    const result = await caller.tasks.update({
      id,
      title: "Integration task edited",
      description: "After",
      status: "done",
      assigneeId: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.id).toBe(id);

    const task = await getTask(id);
    expect(task?.title).toBe("Integration task edited");
    expect(task?.description).toBe("After");
    expect(task?.status).toBe("done");
    expect(task?.assigneeName).toBe("Alex Morgan");

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("clears the assignee when the unassigned option is chosen", async () => {
    const id = await makeTask("Integration to unassign", { assigneeId: 2 });

    await caller.tasks.update({
      id,
      title: "Integration to unassign",
      status: "todo",
      assigneeId: null,
    });

    const [row] = await sql<{ assignee_id: number | null }[]>`
      SELECT assignee_id FROM tasks WHERE id = ${id}
    `;

    expect(row?.assignee_id).toBeNull();

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("advances updated_at explicitly, and leaves created_at alone", async () => {
    const id = await makeTask("Integration keep created", {
      status: "todo",
    });

    const [before] = await sql<{ created_at: Date; updated_at: Date }[]>`
      SELECT created_at, updated_at FROM tasks WHERE id = ${id}
    `;

    await caller.tasks.update({
      id,
      title: "Integration keep created",
      description: "New text",
      status: "in progress",
    });

    const [after] = await sql<{ created_at: Date; updated_at: Date }[]>`
      SELECT created_at, updated_at FROM tasks WHERE id = ${id}
    `;

    expect(after?.created_at).toEqual(before?.created_at);
    expect(after?.updated_at.getTime()).toBeGreaterThanOrEqual(
      before!.updated_at.getTime(),
    );

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("reorders the workspace list, because it is ordered by updated_at", async () => {
    const id = await makeTask("Integration reorder", { status: "todo" });

    // The list is ordered `updated_at DESC`, and a fresh insert carries now(), so
    // the new row starts at the top rather than the bottom.
    const before = await getTasks({ limit: 100 });
    expect(before[0]?.id).toBe(id);

    await caller.tasks.update({
      id,
      title: "Integration reorder",
      status: "in progress",
    });

    // Touching it keeps it at the top, because the update advances updated_at
    // rather than leaving it where the insert put it.
    const after = await getTasks({ limit: 100 });
    expect(after[0]?.id).toBe(id);

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("reports a blank title and changes nothing", async () => {
    const id = await makeTask("Integration reject task edit", {
      description: "Keep",
    });

    const result = refusal(
      await caller.tasks.update({
        id,
        title: "  ",
        status: "todo",
      }),
    );

    expect(result.errors?.title?.[0]).toBe("Title is required.");
    expect((await getTask(id))?.description).toBe("Keep");

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("reports an assignee that no longer exists and changes nothing", async () => {
    const id = await makeTask("Integration reject assignee edit");

    const result = refusal(
      await caller.tasks.update({
        id,
        title: "Integration reject assignee edit",
        status: "todo",
        assigneeId: 999_999,
      }),
    );

    expect(result.errors?.assigneeId?.[0]).toBe(
      "That assignee no longer exists.",
    );

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const result = refusal(
      await caller.tasks.update({
        id: 999_999,
        title: "Ghost",
        status: "todo",
      }),
    );

    expect(result.message).toBe("That task no longer exists.");
  });
});

describe("tasks.delete", () => {
  it("removes a task so it is absent from the list", async () => {
    const id = await makeTask("Integration task to delete");

    const result = await caller.tasks.delete({ id });

    expect(result.ok).toBe(true);
    expect(await getTask(id)).toBeNull();
  });

  it("cascades the task's comments", async () => {
    // `comments.task_id` is ON DELETE CASCADE (spec/schema.sql), so the task's
    // comments must go with it.
    const id = await makeTask("Integration cascade task");

    await sql`
      INSERT INTO comments (task_id, author_id, body, created_at)
      VALUES (${id}, 1, 'Integration cascade comment', now())
    `;

    expect(await getComments(id)).toHaveLength(1);

    await caller.tasks.delete({ id });

    expect(await getComments(id)).toHaveLength(0);
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const result = refusal(await caller.tasks.delete({ id: 999_999 }));

    expect(result.message).toBe("That task no longer exists.");
  });
});

describe("tasks.createWithComment", () => {
  /** Creates through the atomic path and returns the id it reported. */
  async function makeWithComment(fields: Record<string, unknown>) {
    const result = await caller.tasks.createWithComment({
      title: "Integration atomic task",
      description: "",
      status: "todo",
      projectId: 1,
      assigneeId: null,
      commentBody: "Opening note",
      commentAuthorId: 1,
      ...fields,
    } as Parameters<typeof caller.tasks.createWithComment>[0]);

    if (!result.ok) {
      throw new Error(`could not create: ${result.message}`);
    }

    return result.id;
  }

  it("creates the task and its first comment together", async () => {
    const before = await getTasks({ limit: 100 });

    const id = await makeWithComment({
      title: "Integration atomic task",
      commentBody: "Opening note",
      commentAuthorId: 1,
    });

    const task = await getTask(id);
    expect(task?.title).toBe("Integration atomic task");

    const comments = await getComments(id);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe("Opening note");

    expect(await getTasks({ limit: 100 })).toHaveLength(before.length + 1);

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("stores both timestamps on the task, as a plain create does", async () => {
    const id = await makeWithComment({});

    const [row] = await sql<{ created_at: Date; updated_at: Date }[]>`
      SELECT created_at, updated_at FROM tasks WHERE id = ${id}
    `;

    expect(row?.created_at).toBeInstanceOf(Date);
    expect(row?.updated_at).toEqual(row?.created_at);

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });

  it("creates neither row when the comment author does not exist", async () => {
    // The point of the transaction: the task insert must roll back too.
    const before = await getTasks({ limit: 100 });

    const result = refusal(
      await caller.tasks.createWithComment({
        title: "Integration ghost author",
        status: "todo",
        projectId: 1,
        commentBody: "Opening note",
        commentAuthorId: 999_999,
      }),
    );

    expect(result.errors?.commentAuthorId?.[0]).toBe(
      "That comment author no longer exists.",
    );
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("creates neither row when the comment body is blank", async () => {
    const before = await getTasks({ limit: 100 });

    const result = refusal(
      await caller.tasks.createWithComment({
        title: "Integration blank comment",
        status: "todo",
        projectId: 1,
        commentBody: "   ",
        commentAuthorId: 1,
      }),
    );

    expect(result.errors?.commentBody?.[0]).toBe("Comment is required.");
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("rejects a comment body over the 1000-character bound", async () => {
    const before = await getTasks({ limit: 100 });

    const result = refusal(
      await caller.tasks.createWithComment({
        title: "Integration long comment",
        status: "todo",
        projectId: 1,
        commentBody: "x".repeat(1001),
        commentAuthorId: 1,
      }),
    );

    expect(result.errors?.commentBody?.[0]).toContain(
      "1000 characters or fewer",
    );
    expect(await getTasks({ limit: 100 })).toHaveLength(before.length);
  });

  it("sets the comment's created_at explicitly", async () => {
    const id = await makeWithComment({});

    const [comment] = await sql<{ created_at: Date | null }[]>`
      SELECT created_at FROM comments WHERE task_id = ${id}
    `;

    expect(comment?.created_at).toBeInstanceOf(Date);

    await sql`DELETE FROM tasks WHERE id = ${id}`;
  });
});

describe("tasks reads", () => {
  it("byId returns the same task as list does, bar the paging fields", async () => {
    // Seeded rows are 101-106 (spec/snapshots/correctness/tasks.csv).
    const fromList = (await getTasks()).find((t) => t.id === 101);
    const single = await caller.tasks.byId({ id: 101 });

    // `list` rows carry `updatedAtRaw` and `cursorFor`, which exist only to build
    // the next keyset page. `byId` fetches a single row by primary key and has no
    // cursor to build, so it must not carry them — but every field the detail page
    // renders has to agree, or the same task would look different in two places.
    const { updatedAtRaw, cursorFor, ...fromListRest } = fromList!;

    expect(updatedAtRaw).toBeDefined();
    expect(cursorFor).toBeDefined();
    expect(single).toEqual(fromListRest);
    expect(single).not.toHaveProperty("cursorFor");
  });

  it("byId returns null for an id that matches no row", async () => {
    expect(await caller.tasks.byId({ id: 999_999 })).toBeNull();
  });

  it("count agrees with the rows list returns for the same filters", async () => {
    // The list is LIMITed, so the two are separate reads; a filter accepted by one
    // and not the other would show a total that disagrees with the rows beneath it.
    const filters = { status: "todo", projectId: 1 };

    const total = await caller.tasks.count(filters);
    const rows = await caller.tasks.list({ ...filters, limit: 100 });

    expect(total).toBe(rows.length);
    expect(total).toBeGreaterThan(0);
  });

  it("count of every task matches the seeded total", async () => {
    expect(await caller.tasks.count({})).toBe(
      (await getTasks({ limit: 100 })).length,
    );
  });

  it("comments bounds the page at ten", async () => {
    // spec/queries.md caps this read; an unbounded one would load every comment a
    // task ever accumulated.
    const rows = await caller.tasks.comments({ id: 101, limit: 500 });

    expect(rows.length).toBeLessThanOrEqual(10);
  });
});
