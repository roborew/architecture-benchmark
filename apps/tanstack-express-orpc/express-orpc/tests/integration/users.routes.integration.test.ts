// tests/integration/users.routes.integration.test.ts
//
// The users procedures — the reads behind the People listing and member pages,
// and the writes behind the member forms. Exercises the full stack (Express
// mount → RPCHandler → router → model → Postgres) through an oRPC client
// against the seeded test database — the same RPCLink transport the SPA's
// client uses — and asserts the exact rows the shared fixture produces so a
// SQL drift is caught here, not in the browser.
//
// The list row shape and ordering mirror the reference variant's getUsers
// (display_name DESC, id DESC, the DISTINCT aggregate counts); the member's
// tasks mirror getUserTasks (updated_at DESC, id DESC, the shared task
// projection).

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startRpcServer, stopRpcServer } from "../helpers/rpc-server.ts";
import type { RpcServer } from "../helpers/rpc-server.ts";

// The search contract mirrors the reference variant's getUsers integration
// suite (case-insensitive name match, email match, wildcard escaping), with the
// value rules the router still owns (an over-long q rejects with the
// reference's message).

// The seeded fixture (spec/snapshots/correctness), worked through by hand:
//
//   users   1 Robin Andrew, 2 Alex Morgan, 3 Sam Taylor
//   tasks   101, 105 → user 1 (both "in progress")
//           102, 104 → user 2 (both "todo")
//           103     → user 3 ("done"), 106 → user 3 ("todo")
//   comments  1 (author 2), 2 (author 1), 3 (author 2)
//
// Expected rows, in display_name DESC, id DESC order (the getUsers contract):
const EXPECTED_USERS = [
  {
    id: 3,
    name: "Sam Taylor",
    email: "sam@example.test",
    assignedTaskCount: 2,
    openTaskCount: 1, // 106 only: 103 is done
    commentCount: 0,
  },
  {
    id: 1,
    name: "Robin Andrew",
    email: "robin@example.test",
    assignedTaskCount: 2,
    openTaskCount: 2,
    commentCount: 1,
  },
  {
    id: 2,
    name: "Alex Morgan",
    email: "alex@example.test",
    assignedTaskCount: 2,
    openTaskCount: 2,
    commentCount: 2,
  },
];

let rpc: RpcServer;

beforeAll(() => {
  rpc = startRpcServer();
});

afterAll(async () => {
  await stopRpcServer(rpc.server);
});

describe("users.list", () => {
  it("resolves to an array", async () => {
    const users = await rpc.client.users.list({});

    expect(Array.isArray(users)).toBe(true);
  });

  it("returns exactly the seeded members and aggregate columns", async () => {
    const users = await rpc.client.users.list({});

    // toEqual (not toMatchObject): the row shape is the API contract — an
    // extra or missing key is a breaking change for the client that renders it.
    expect(users).toEqual(EXPECTED_USERS);
  });

  it("orders members by display name descending, then id descending", async () => {
    const users = await rpc.client.users.list({});

    expect(users.map((user) => user.id)).toEqual([3, 1, 2]);
  });

  it("counts the join-safe aggregates the listing table renders", async () => {
    const users = await rpc.client.users.list({});

    const byEmail = new Map(users.map((user) => [user.email, user]));

    // The two LEFT JOINs multiply rows (a member with 2 tasks and 2 comments
    // produces 4 joined rows), so a non-DISTINCT count would double-report.
    expect(byEmail.get("alex@example.test")).toMatchObject({
      assignedTaskCount: 2,
      commentCount: 2,
    });
    // "done" tasks count as assigned but not open.
    expect(byEmail.get("sam@example.test")).toMatchObject({
      assignedTaskCount: 2,
      openTaskCount: 1,
    });
  });

  it("matches a member name case-insensitively", async () => {
    const users = await rpc.client.users.list({ q: "ROBIN" });

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      id: 1,
      name: "Robin Andrew",
    });
  });

  it("matches on email as well as name", async () => {
    const users = await rpc.client.users.list({ q: "alex@example.test" });

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: 2 });
  });

  it("returns an empty array for a term that matches no member", async () => {
    const users = await rpc.client.users.list({ q: "no-such-person" });

    expect(users).toEqual([]);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    // A bare `%` would otherwise match every row and hide a real escaping bug.
    const percent = await rpc.client.users.list({ q: "%" });
    const underscore = await rpc.client.users.list({ q: "_" });

    expect(percent).toEqual([]);
    expect(underscore).toEqual([]);
  });

  it("ignores surrounding whitespace", async () => {
    const users = await rpc.client.users.list({ q: "  Robin Andrew  " });

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: 1 });
  });

  it("rejects when q is longer than 100 characters", async () => {
    await expect(
      rpc.client.users.list({ q: "a".repeat(101) }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { error: "q must be at most 100 characters" },
    });
  });
});

describe("users.byId", () => {
  it("returns exactly the member row, with the same aggregates as the list", async () => {
    const user = await rpc.client.users.byId({ id: 1 });

    expect(user).toEqual({
      id: 1,
      name: "Robin Andrew",
      email: "robin@example.test",
      assignedTaskCount: 2,
      openTaskCount: 2,
      commentCount: 1,
    });
  });

  it("rejects with the plain not-found envelope for an unknown id", async () => {
    await expect(rpc.client.users.byId({ id: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "Not found" },
    });
  });
});

describe("users.tasks", () => {
  it("returns the member's tasks, newest updated first, with project names", async () => {
    const tasks = await rpc.client.users.tasks({ id: 3 });

    expect(tasks).toEqual([
      {
        id: 103,
        projectId: 1,
        projectName: "Website redesign",
        title: "Prepare content inventory",
        description:
          "Collect the copy and imagery currently live across the public pages.",
        status: "done",
        assigneeName: "Sam Taylor",
        commentCount: 0,
        updatedAt: "2026-09-27T16:45:00Z",
      },
      {
        id: 106,
        projectId: 3,
        projectName: "Platform migration",
        title: "Write migration checklist",
        description:
          "List the steps and owners for moving to the new platform.",
        status: "todo",
        assigneeName: "Sam Taylor",
        commentCount: 0,
        updatedAt: "2026-09-23T11:20:00Z",
      },
    ]);
  });

  it("scopes by assignee_id, not by display name", async () => {
    // Two members can share a display name (users.display_name has no UNIQUE
    // constraint); a name filter would hand each of them the other's work.
    // Here the scope is simply id 1's own two tasks.
    const tasks = await rpc.client.users.tasks({ id: 1 });

    expect(tasks.map((task) => task.id)).toEqual([101, 105]);
  });

  it("returns an empty list for a member with no tasks", async () => {
    const tasks = await rpc.client.users.tasks({ id: 999 });

    expect(tasks).toEqual([]);
  });
});

describe("users.create", () => {
  it("creates the member and redirects to their page", async () => {
    const result = await rpc.client.users.create({
      name: "New Person",
      email: "new@example.test",
    });

    expect(result).toEqual({
      ok: true,
      message: "User created.",
      redirectTo: "/users/4",
    });

    const detail = await rpc.client.users.byId({ id: 4 });

    expect(detail).toMatchObject({
      id: 4,
      name: "New Person",
      email: "new@example.test",
    });
  });

  it("reports the reference's field errors for an invalid body", async () => {
    await expect(
      rpc.client.users.create({
        name: "Bad Email",
        email: "not-an-address",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create user.",
        errors: { email: ["Enter a valid email address."] },
      },
    });
  });

  it("reports an omitted name exactly as the reference's form does", async () => {
    await expect(
      rpc.client.users.create({ email: "new@example.test" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create user.",
        errors: { name: ["Invalid input: expected string, received null"] },
      },
    });
  });
});

describe("users.update", () => {
  it("updates the member and redirects to their page", async () => {
    const result = await rpc.client.users.update({
      id: 1,
      name: "Robin Andrew (contractor)",
      email: "robin@example.test",
    });

    expect(result).toEqual({
      ok: true,
      message: "User updated.",
      redirectTo: "/users/1",
    });

    const detail = await rpc.client.users.byId({ id: 1 });

    expect(detail).toMatchObject({
      id: 1,
      name: "Robin Andrew (contractor)",
    });
  });

  it("returns the reference's 404 message for an unknown member", async () => {
    await expect(
      rpc.client.users.update({
        id: 999,
        name: "No such",
        email: "nobody@example.test",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That user no longer exists." },
    });
  });
});

describe("users.remove", () => {
  it("deletes a member with no comments, unassigning their tasks", async () => {
    // Sam (3) has no comments but two tasks; tasks.assignee_id is ON DELETE
    // SET NULL, so the delete succeeds and unassigns rather than blocking.
    const result = await rpc.client.users.remove({ id: 3 });

    expect(result).toEqual({
      ok: true,
      message: "User deleted.",
      redirectTo: "/users",
    });

    await expect(rpc.client.users.byId({ id: 3 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "Not found" },
    });

    // The tasks survive, unassigned.
    const task103 = await rpc.client.tasks.byId({ id: 103 });

    expect(task103).toMatchObject({ id: 103, assigneeName: "Unassigned" });
  });

  it("refuses a member who authored comments, with the reference's guard", async () => {
    // Alex (2) wrote two comments and has two tasks; the comment count is what
    // blocks the delete (RESTRICT), the task count is context (SET NULL).
    await expect(rpc.client.users.remove({ id: 2 })).rejects.toMatchObject({
      code: "CONFLICT",
      data: {
        error:
          "This person still has 2 comments and 2 tasks. Remove the comments before deleting.",
      },
    });

    // The refused delete changed nothing: the member still resolves.
    const detail = await rpc.client.users.byId({ id: 2 });

    expect(detail.id).toBe(2);
  });

  it("returns the reference's 404 message for an unknown member", async () => {
    await expect(rpc.client.users.remove({ id: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That user no longer exists." },
    });
  });
});
