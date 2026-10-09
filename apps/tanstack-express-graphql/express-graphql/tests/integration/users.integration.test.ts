// tests/integration/users.integration.test.ts
//
// The users surface — the reads behind the People listing and member pages,
// and the writes behind the member forms. Exercises the full stack
// (POST /graphql → resolvers → models → Postgres) through supertest against
// the seeded test database, and asserts the exact rows the shared fixture
// produces so a SQL drift is caught here, not in the browser.
//
// The list row shape and ordering mirror the reference variant's getUsers
// (display_name DESC, id DESC, the DISTINCT aggregate counts); the member's
// tasks mirror getUserTasks (updated_at DESC, id DESC, the shared task
// projection).
//
// Every argument travels as a variable, every refusal is HTTP 200 with the
// error inside `errors` — the old 400 `{ error }` envelopes are now
// `errors[0].message` with `extensions.code: "BAD_INPUT"`, the old 404/409
// outcomes carry NOT_FOUND/CONFLICT.

import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "../../src/app.ts";

function gql(
  app: Express,
  query: string,
  variables: Record<string, unknown> = {},
) {
  return request(app).post("/graphql").send({ query, variables });
}

const USERS_QUERY = `
  query Users($q: String) {
    users(q: $q) {
      id
      name
      email
      assignedTaskCount
      openTaskCount
      commentCount
    }
  }
`;

const USER_QUERY = `
  query User($id: Int!) {
    user(id: $id) {
      id
      name
      email
      assignedTaskCount
      openTaskCount
      commentCount
    }
  }
`;

const USER_TASKS_QUERY = `
  query UserTasks($userId: Int!) {
    userTasks(userId: $userId) {
      id
      projectId
      projectName
      title
      description
      status
      assigneeName
      commentCount
      updatedAt
    }
  }
`;

const CREATE_USER_MUTATION = `
  mutation CreateUser($name: String, $email: String) {
    createUser(name: $name, email: $email) {
      ok
      message
      redirectTo
    }
  }
`;

const UPDATE_USER_MUTATION = `
  mutation UpdateUser($id: Int!, $name: String, $email: String) {
    updateUser(id: $id, name: $name, email: $email) {
      ok
      message
      redirectTo
    }
  }
`;

const DELETE_USER_MUTATION = `
  mutation DeleteUser($id: Int!) {
    deleteUser(id: $id) {
      ok
      message
      redirectTo
    }
  }
`;

// A task read, for the delete tests' SET-NULL follow-up.
const TASK_QUERY = `
  query Task($id: Int!) {
    task(id: $id) {
      id
      assigneeName
    }
  }
`;

// The seeded fixture (spec/snapshots/correctness), worked through by hand:
//
//   users   1 Robin Andrew, 2 Alex Morgan, 3 Sam Taylor
//   tasks   101, 105 → user 1 (both "in progress")
//           102, 104 → user 2 (both "todo")
//           103     → user 3 ("done"), 106 → user 3 ("todo")
//   comments  1 (author 2), 2 (author 1), 3 (author 2)
//
// Expected rows, in display_name DESC, id DESC order (the users contract):
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

describe("query users", () => {
  it("returns 200 with a JSON body and an array under data", async () => {
    const response = await gql(createApp(), USERS_QUERY);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(Array.isArray(response.body.data.users)).toBe(true);
  });

  it("returns exactly the seeded members and aggregate columns", async () => {
    const response = await gql(createApp(), USERS_QUERY);

    // toEqual (not toMatchObject): the row shape is the API contract — an
    // extra or missing key is a breaking change for the client that renders it.
    expect(response.body.data.users).toEqual(EXPECTED_USERS);
  });

  it("orders members by display name descending, then id descending", async () => {
    const response = await gql(createApp(), USERS_QUERY);

    expect(response.body.data.users.map((user: { id: number }) => user.id)).toEqual([
      3, 1, 2,
    ]);
  });

  it("counts the join-safe aggregates the listing table renders", async () => {
    const response = await gql(createApp(), USERS_QUERY);

    const byEmail = new Map(
      response.body.data.users.map((user: { email: string }) => [
        user.email,
        user,
      ]),
    );

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
    const response = await gql(createApp(), USERS_QUERY, { q: "ROBIN" });

    expect(response.body.data.users).toHaveLength(1);
    expect(response.body.data.users[0]).toMatchObject({
      id: 1,
      name: "Robin Andrew",
    });
  });

  it("matches on email as well as name", async () => {
    const response = await gql(createApp(), USERS_QUERY, {
      q: "alex@example.test",
    });

    expect(response.body.data.users).toHaveLength(1);
    expect(response.body.data.users[0]).toMatchObject({ id: 2 });
  });

  it("returns an empty array for a term that matches no member", async () => {
    const response = await gql(createApp(), USERS_QUERY, {
      q: "no-such-person",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.users).toEqual([]);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    // A bare `%` would otherwise match every row and hide a real escaping bug.
    const percent = await gql(createApp(), USERS_QUERY, { q: "%" });
    const underscore = await gql(createApp(), USERS_QUERY, { q: "_" });

    expect(percent.body.data.users).toEqual([]);
    expect(underscore.body.data.users).toEqual([]);
  });

  it("ignores surrounding whitespace", async () => {
    const response = await gql(createApp(), USERS_QUERY, {
      q: "  Robin Andrew  ",
    });

    expect(response.body.data.users).toHaveLength(1);
    expect(response.body.data.users[0]).toMatchObject({ id: 1 });
  });

  it("answers BAD_INPUT when q is longer than 100 characters", async () => {
    const response = await gql(createApp(), USERS_QUERY, {
      q: "a".repeat(101),
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "q must be at most 100 characters",
      extensions: { code: "BAD_INPUT" },
    });
  });
});

describe("query user", () => {
  it("returns exactly the member row, with the same aggregates as the list", async () => {
    const response = await gql(createApp(), USER_QUERY, { id: 1 });

    expect(response.status).toBe(200);
    expect(response.body.data.user).toEqual({
      id: 1,
      name: "Robin Andrew",
      email: "robin@example.test",
      assignedTaskCount: 2,
      openTaskCount: 2,
      commentCount: 1,
    });
  });

  it("answers NOT_FOUND for an unknown id", async () => {
    const response = await gql(createApp(), USER_QUERY, { id: 999 });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Not found",
      extensions: { code: "NOT_FOUND" },
    });
  });

  it("answers BAD_INPUT for an id that cannot name a row", async () => {
    // The REST guard rejected "/api/users/abc" with this message; GraphQL's
    // Int! argument reaches the same guard with a non-positive integer.
    const response = await gql(createApp(), USER_QUERY, { id: 0 });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "id must be a positive integer",
      extensions: { code: "BAD_INPUT" },
    });
  });
});

describe("query userTasks", () => {
  it("returns the member's tasks, newest updated first, with project names", async () => {
    const response = await gql(createApp(), USER_TASKS_QUERY, { userId: 3 });

    expect(response.status).toBe(200);
    expect(response.body.data.userTasks).toEqual([
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
        description: "List the steps and owners for moving to the new platform.",
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
    const response = await gql(createApp(), USER_TASKS_QUERY, { userId: 1 });

    expect(response.body.data.userTasks.map((task: { id: number }) => task.id)).toEqual([
      101, 105,
    ]);
  });

  it("returns an empty list for a member with no tasks", async () => {
    // A member id that owns nothing — or no longer exists — has an empty list,
    // not an error: the read is scoped, not addressed to the row.
    const response = await gql(createApp(), USER_TASKS_QUERY, { userId: 999 });

    expect(response.status).toBe(200);
    expect(response.body.data.userTasks).toEqual([]);
  });
});

describe("mutation createUser", () => {
  it("creates the member and points the client at their page", async () => {
    const response = await gql(createApp(), CREATE_USER_MUTATION, {
      name: "New Person",
      email: "new@example.test",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.createUser).toEqual({
      ok: true,
      message: "User created.",
      redirectTo: "/users/4",
    });

    const detail = await gql(createApp(), USER_QUERY, { id: 4 });

    expect(detail.status).toBe(200);
    expect(detail.body.data.user).toMatchObject({
      id: 4,
      name: "New Person",
      email: "new@example.test",
    });
  });

  it("reports the reference's field errors for an invalid body", async () => {
    const response = await gql(createApp(), CREATE_USER_MUTATION, {
      name: "Bad Email",
      email: "not-an-address",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create user.",
      extensions: {
        code: "BAD_INPUT",
        errors: { email: ["Enter a valid email address."] },
      },
    });
  });

  it("reports an omitted name exactly as the reference's form does", async () => {
    // The name variable is simply not sent — the form field was absent.
    const response = await gql(createApp(), CREATE_USER_MUTATION, {
      email: "new@example.test",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create user.",
      extensions: {
        code: "BAD_INPUT",
        errors: { name: ["Invalid input: expected string, received null"] },
      },
    });
  });
});

describe("mutation updateUser", () => {
  it("updates the member and points the client back at their page", async () => {
    const response = await gql(createApp(), UPDATE_USER_MUTATION, {
      id: 1,
      name: "Robin Andrew (contractor)",
      email: "robin@example.test",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.updateUser).toEqual({
      ok: true,
      message: "User updated.",
      redirectTo: "/users/1",
    });

    const detail = await gql(createApp(), USER_QUERY, { id: 1 });

    expect(detail.body.data.user).toMatchObject({
      id: 1,
      name: "Robin Andrew (contractor)",
    });
  });

  it("answers NOT_FOUND with the reference's message for an unknown member", async () => {
    const response = await gql(createApp(), UPDATE_USER_MUTATION, {
      id: 999,
      name: "No such",
      email: "nobody@example.test",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "That user no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });
});

describe("mutation deleteUser", () => {
  it("deletes a member with no comments, unassigning their tasks", async () => {
    // Sam (3) has no comments but two tasks; tasks.assignee_id is ON DELETE
    // SET NULL, so the delete succeeds and unassigns rather than blocking.
    const response = await gql(createApp(), DELETE_USER_MUTATION, { id: 3 });

    expect(response.status).toBe(200);
    expect(response.body.data.deleteUser).toEqual({
      ok: true,
      message: "User deleted.",
      redirectTo: "/users",
    });

    const detail = await gql(createApp(), USER_QUERY, { id: 3 });

    expect(detail.body.data).toBeNull();
    expect(detail.body.errors[0]).toMatchObject({
      message: "Not found",
      extensions: { code: "NOT_FOUND" },
    });

    // The tasks survive, unassigned.
    const task103 = await gql(createApp(), TASK_QUERY, { id: 103 });

    expect(task103.body.data.task).toMatchObject({
      id: 103,
      assigneeName: "Unassigned",
    });
  });

  it("refuses a member who authored comments, with the reference's guard", async () => {
    // Alex (2) wrote two comments and has two tasks; the comment count is
    // what blocks the delete (RESTRICT), the task count is context (SET NULL).
    const response = await gql(createApp(), DELETE_USER_MUTATION, { id: 2 });

    // The old 409 guard outcome: the actionable message in `errors`, CONFLICT
    // as the code the SPA's api client maps back to 409.
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message:
        "This person still has 2 comments and 2 tasks. Remove the comments before deleting.",
      extensions: { code: "CONFLICT" },
    });

    // The refused delete changed nothing.
    const detail = await gql(createApp(), USER_QUERY, { id: 2 });

    expect(detail.status).toBe(200);
    expect(detail.body.data.user).toMatchObject({ id: 2 });
  });

  it("answers NOT_FOUND with the reference's message for an unknown member", async () => {
    const response = await gql(createApp(), DELETE_USER_MUTATION, { id: 999 });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "That user no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });
});
