import { afterAll, describe, expect, it } from "vitest";

import { getUser, getUsers } from "@/lib/data";
import { sql } from "@/lib/db";
import { createRouterClient } from "@orpc/server";

import { router } from "@/orpc/routers/_app";

// The people write path, judged by its persisted result rather than by the
// procedure's return value alone (spec/contract.md). `users.email` has no UNIQUE
// constraint (spec/schema.sql), so duplicate addresses are legal and must not be
// rejected — the schema is the authority, not a nicety the app invented.
//
// Procedures are invoked through a caller rather than the Server Actions these
// replaced. One consequence makes this file much simpler: a successful mutation
// used to end in `redirect()`, which threw outside a Next request context, so
// every success case needed `await expect(...).rejects.toThrow()` and then a
// read-back. A procedure returns `{ ok: true, id }` instead, so the id it
// reports is the id the test asserts against.

afterAll(async () => {
  await sql.end();
});

// oRPC's equivalent of tRPC's `appRouter.createCaller({})`: an in-process
// client, so the procedure runs directly with no HTTP hop.
const caller = createRouterClient(router, { context: {} });

/** Narrows a refused result so the field errors are readable. */
function refusal(result: Awaited<ReturnType<typeof caller.users.create>>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected the procedure to refuse");
  return result;
}

/**
 * Creates a member and returns the stored row.
 *
 * Reads the row back by the id the procedure reported, rather than diffing the
 * list by name, so a test may pass an untrimmed value and still find what was
 * actually persisted.
 */
async function makeUser(name: string, email: string) {
  const result = await caller.users.create({ name, email });

  if (!result.ok) {
    throw new Error(`could not create ${name}: ${result.message}`);
  }

  const created = await getUser(result.id);
  expect(created, `could not read back ${name}`).not.toBeNull();

  return created!;
}

async function removeUser(name: string) {
  await sql`DELETE FROM users WHERE display_name = ${name}`;
}

describe("users.create", () => {
  it("inserts a row that the read layer returns", async () => {
    const before = await getUsers();

    await makeUser("Integration created", "integration-created@example.test");

    const after = await getUsers();
    const created = after.find((u) => u.name === "Integration created");

    expect(created?.email).toBe("integration-created@example.test");
    // A brand-new member has no work yet, so the aggregates are zero.
    expect(created?.assignedTaskCount).toBe(0);
    expect(created?.openTaskCount).toBe(0);
    expect(created?.commentCount).toBe(0);

    expect(after).toHaveLength(before.length + 1);

    await removeUser("Integration created");
  });

  it("reports the allocated id", async () => {
    // spec/contract.md: a create must leave a persisted id behind, not merely
    // return success.
    const result = await caller.users.create({
      name: "Integration id",
      email: "integration-id@example.test",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(await getUser(result.id)).not.toBeNull();

    await removeUser("Integration id");
  });

  it("rejects a blank name without inserting", async () => {
    const before = await getUsers();

    const result = refusal(
      await caller.users.create({ name: "   ", email: "blank@example.test" }),
    );

    expect(result.errors?.name?.[0]).toBe("User name is required.");
    expect(await getUsers()).toHaveLength(before.length);
  });

  it("rejects a blank email without inserting", async () => {
    const before = await getUsers();

    const result = refusal(
      await caller.users.create({ name: "No Email", email: "  " }),
    );

    expect(result.errors?.email?.[0]).toBe("Email is required.");
    expect(await getUsers()).toHaveLength(before.length);
  });

  it("rejects a malformed email address", async () => {
    const before = await getUsers();

    const result = refusal(
      await caller.users.create({ name: "Bad Email", email: "not-an-email" }),
    );

    expect(result.errors?.email?.[0]).toBeDefined();
    expect(await getUsers()).toHaveLength(before.length);
  });

  it("trims surrounding whitespace from both fields", async () => {
    await makeUser("  Integration trimmed  ", "  trimmed@example.test  ");

    const found = (await getUsers()).find(
      (u) => u.name === "Integration trimmed",
    );

    expect(found?.email).toBe("trimmed@example.test");

    await removeUser("Integration trimmed");
  });

  it("allows a duplicate email, because the schema has no UNIQUE constraint", async () => {
    // Rejecting this would be inventing a rule the schema does not state, and
    // `spec/contract.md` lists no uniqueness requirement for email.
    await makeUser("Integration Twin A", "shared@example.test");
    await makeUser("Integration Twin B", "shared@example.test");

    const shared = (await getUsers()).filter(
      (u) => u.email === "shared@example.test",
    );

    expect(shared).toHaveLength(2);

    await removeUser("Integration Twin A");
    await removeUser("Integration Twin B");
  });
});

describe("users.update", () => {
  it("updates the intended row and nothing else", async () => {
    const created = await makeUser(
      "Integration to edit",
      "before@example.test",
    );

    const result = await caller.users.update({
      id: created.id,
      name: "Integration edited",
      email: "after@example.test",
    });

    expect(result.ok).toBe(true);

    const updated = await getUser(created.id);
    expect(updated?.name).toBe("Integration edited");
    expect(updated?.email).toBe("after@example.test");

    await removeUser("Integration edited");
  });

  it("keeps the assigned-task and comment counts attached to the id", async () => {
    // Robin is seeded with 2 tasks and 1 comment. Editing the name must not
    // disturb those aggregates, which are keyed on the id.
    const robin = (await getUsers()).find(
      (u) => u.email === "robin@example.test",
    )!;

    await caller.users.update({
      id: robin.id,
      name: "Robin Andrew",
      email: "robin@example.test",
    });

    const after = await getUser(robin.id);
    expect(after?.assignedTaskCount).toBe(robin.assignedTaskCount);
    expect(after?.commentCount).toBe(robin.commentCount);
  });

  it("reports a blank name and changes nothing", async () => {
    const created = await makeUser(
      "Integration reject edit",
      "keep@example.test",
    );

    const result = refusal(
      await caller.users.update({
        id: created.id,
        name: "  ",
        email: "new@example.test",
      }),
    );

    expect(result.errors?.name?.[0]).toBe("User name is required.");
    expect((await getUser(created.id))?.email).toBe("keep@example.test");

    await removeUser("Integration reject edit");
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const result = refusal(
      await caller.users.update({
        id: 999_999,
        name: "Ghost",
        email: "ghost@example.test",
      }),
    );

    expect(result.message).toBe("That user no longer exists.");
  });
});

describe("users.delete", () => {
  it("removes a member who has no work attached", async () => {
    const created = await makeUser(
      "Integration to delete",
      "delete@example.test",
    );

    const result = await caller.users.delete({ id: created.id });

    expect(result.ok).toBe(true);
    expect(await getUser(created.id)).toBeNull();
  });

  it("unassigns the member's tasks rather than deleting them", async () => {
    // `tasks.assignee_id` is ON DELETE SET NULL, so the work must survive.
    const created = await makeUser(
      "Integration with task",
      "with-task@example.test",
    );

    const [task] = await sql<{ id: number }[]>`
      INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
      VALUES (1, ${created.id}, 'Integration assigned task', '', 'todo', '2026-10-25T09:00:00Z', '2026-10-25T09:00:00Z')
      RETURNING id::int AS id
    `;

    try {
      const result = await caller.users.delete({ id: created.id });

      expect(result.ok).toBe(true);

      const [row] = await sql<{ assignee_id: number | null }[]>`
        SELECT assignee_id FROM tasks WHERE id = ${task.id}
      `;

      expect(row?.assignee_id).toBeNull();
    } finally {
      await sql`DELETE FROM tasks WHERE title = 'Integration assigned task'`;
    }
  });

  it("is blocked by the foreign key when the member authored comments", async () => {
    // `comments.author_id` is ON DELETE RESTRICT, so this must not succeed.
    // Alex authored two of the seeded comments.
    const alex = (await getUsers()).find(
      (u) => u.email === "alex@example.test",
    )!;

    const result = refusal(await caller.users.delete({ id: alex.id }));

    expect(result.message).toContain("still has 2 comments");
    expect(await getUser(alex.id)).not.toBeNull();
  });

  it("reports a task count the user can act on alongside the comment block", async () => {
    const alex = (await getUsers()).find(
      (u) => u.email === "alex@example.test",
    )!;

    const result = refusal(await caller.users.delete({ id: alex.id }));

    // Alex also has assigned tasks, so the message names both blockers.
    expect(result.message).toContain("2 comments");
    expect(result.message).toContain("2 tasks");
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const result = refusal(await caller.users.delete({ id: 999_999 }));

    expect(result.message).toBe("That user no longer exists.");
  });
});
