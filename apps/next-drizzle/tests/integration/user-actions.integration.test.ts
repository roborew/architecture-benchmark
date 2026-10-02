import { afterAll, describe, expect, it } from "vitest";

import { createUser, deleteUser, updateUser, type State } from "@/lib/actions";
import { getUser, getUsers } from "@/lib/data";
import { sql } from "../e2e/query";

// The people write path, judged by its persisted result rather than by the
// action's return value alone (spec/contract.md). `users.email` has no UNIQUE
// constraint (spec/schema.sql), so duplicate addresses are legal and must not
// be rejected — the schema is the authority, not a nicety the app invented.

afterAll(async () => {
  await sql.end();
});

function form(name: string, email: string) {
  const data = new FormData();
  data.append("name", name);
  data.append("email", email);

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

/**
 * Creates a member and returns the stored row.
 *
 * Looks the row up by id rather than by the submitted name, so a test may pass
 * an untrimmed value and still find what the server persisted.
 */
async function makeUser(name: string, email: string) {
  const before = new Set((await getUsers()).map((u) => u.id));

  await run(createUser({}, form(name, email)));

  const created = (await getUsers()).find((u) => !before.has(u.id));
  expect(created, `could not create ${name}`).toBeDefined();

  return created!;
}

async function removeUser(name: string) {
  await sql`DELETE FROM users WHERE display_name = ${name}`;
}

describe("createUser", () => {
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

  it("rejects a blank name without inserting", async () => {
    const before = await getUsers();

    const state = await createUser({}, form("   ", "blank@example.test"));

    expect(state.errors?.name?.[0]).toBe("User name is required.");
    expect(await getUsers()).toHaveLength(before.length);
  });

  it("rejects a blank email without inserting", async () => {
    const before = await getUsers();

    const state = await createUser({}, form("No Email", "  "));

    expect(state.errors?.email?.[0]).toBe("Email is required.");
    expect(await getUsers()).toHaveLength(before.length);
  });

  it("rejects a malformed email address", async () => {
    const before = await getUsers();

    const state = await createUser({}, form("Bad Email", "not-an-email"));

    expect(state.errors?.email?.[0]).toBeDefined();
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

describe("updateUser", () => {
  it("updates the intended row and nothing else", async () => {
    const created = await makeUser(
      "Integration to edit",
      "before@example.test",
    );

    await expect(
      updateUser(
        created.id,
        {},
        form("Integration edited", "after@example.test"),
      ),
    ).rejects.toThrow();

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

    await expect(
      updateUser(robin.id, {}, form("Robin Andrew", "robin@example.test")),
    ).rejects.toThrow();

    const after = await getUser(robin.id);
    expect(after?.assignedTaskCount).toBe(robin.assignedTaskCount);
    expect(after?.commentCount).toBe(robin.commentCount);
  });

  it("reports a blank name and changes nothing", async () => {
    const created = await makeUser(
      "Integration reject edit",
      "keep@example.test",
    );

    const state = await updateUser(
      created.id,
      {},
      form("  ", "new@example.test"),
    );

    expect(state.errors?.name?.[0]).toBe("User name is required.");
    expect((await getUser(created.id))?.email).toBe("keep@example.test");

    await removeUser("Integration reject edit");
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const state = await updateUser(
      999_999,
      {},
      form("Ghost", "ghost@example.test"),
    );

    expect(state.message).toBe("That user no longer exists.");
  });
});

describe("deleteUser", () => {
  it("removes a member who has no work attached", async () => {
    const created = await makeUser(
      "Integration to delete",
      "delete@example.test",
    );

    await expect(deleteUser(created.id, {}, new FormData())).rejects.toThrow();

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
      await expect(
        deleteUser(created.id, {}, new FormData()),
      ).rejects.toThrow();

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

    const state = await deleteUser(alex.id, {}, new FormData());

    expect(state.message).toContain("still has 2 comments");
    expect(await getUser(alex.id)).not.toBeNull();
  });

  it("reports a task count the user can act on alongside the comment block", async () => {
    const alex = (await getUsers()).find(
      (u) => u.email === "alex@example.test",
    )!;

    const state = await deleteUser(alex.id, {}, new FormData());

    // Alex also has assigned tasks, so the message names both blockers.
    expect(state.message).toContain("2 comments");
    expect(state.message).toContain("2 tasks");
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const state = await deleteUser(999_999, {}, new FormData());

    expect(state.message).toBe("That user no longer exists.");
  });
});
