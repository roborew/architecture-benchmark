// tests/integration/users.routes.integration.test.ts
//
// The /api/users surface — the reads behind the People listing and member
// pages, and the writes behind the member forms. Exercises the full HTTP stack
// (routes → controller → model → Postgres) through supertest against the
// seeded test database, and asserts the exact rows the shared fixture
// produces so a SQL drift is caught here, not in the browser.
//
// The list row shape and ordering mirror the reference variant's getUsers
// (display_name DESC, id DESC, the DISTINCT aggregate counts); the member's
// tasks mirror getUserTasks (updated_at DESC, id DESC, the shared task
// projection).

import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/app.ts";

// The search contract mirrors the reference variant's getUsers integration
// suite (case-insensitive name match, email match, wildcard escaping), with
// the HTTP boundaries the REST layer adds: 400 envelopes for malformed q.

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

describe("GET /api/users", () => {
  it("returns 200 with a JSON array", async () => {
    const response = await request(createApp()).get("/api/users");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it("returns exactly the seeded members and aggregate columns", async () => {
    const response = await request(createApp()).get("/api/users");

    // toEqual (not toMatchObject): the row shape is the API contract — an
    // extra or missing key is a breaking change for the client that renders it.
    expect(response.body).toEqual(EXPECTED_USERS);
  });

  it("orders members by display name descending, then id descending", async () => {
    const response = await request(createApp()).get("/api/users");

    expect(response.body.map((user: { id: number }) => user.id)).toEqual([
      3, 1, 2,
    ]);
  });

  it("counts the join-safe aggregates the listing table renders", async () => {
    const response = await request(createApp()).get("/api/users");

    const byEmail = new Map(
      response.body.map((user: { email: string }) => [user.email, user]),
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
    const response = await request(createApp()).get("/api/users?q=ROBIN");

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: 1,
      name: "Robin Andrew",
    });
  });

  it("matches on email as well as name", async () => {
    const response = await request(createApp()).get(
      "/api/users?q=alex@example.test",
    );

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: 2 });
  });

  it("returns an empty array for a term that matches no member", async () => {
    const response = await request(createApp()).get(
      "/api/users?q=no-such-person",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    // A bare `%` would otherwise match every row and hide a real escaping bug.
    const percent = await request(createApp()).get("/api/users?q=%");
    const underscore = await request(createApp()).get("/api/users?q=_");

    expect(percent.body).toEqual([]);
    expect(underscore.body).toEqual([]);
  });

  it("ignores surrounding whitespace", async () => {
    const response = await request(createApp()).get(
      "/api/users?q=%20%20Robin%20Andrew%20%20",
    );

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: 1 });
  });

  it("returns 400 when q is repeated", async () => {
    const response = await request(createApp()).get("/api/users?q=robin&q=sam");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "q must be a single value" });
  });

  it("returns 400 when q is longer than 100 characters", async () => {
    const response = await request(createApp()).get(
      `/api/users?q=${"a".repeat(101)}`,
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "q must be at most 100 characters",
    });
  });
});

describe("GET /api/users/:id", () => {
  it("returns exactly the member row, with the same aggregates as the list", async () => {
    const response = await request(createApp()).get("/api/users/1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 1,
      name: "Robin Andrew",
      email: "robin@example.test",
      assignedTaskCount: 2,
      openTaskCount: 2,
      commentCount: 1,
    });
  });

  it("returns the plain 404 envelope for an unknown id", async () => {
    const response = await request(createApp()).get("/api/users/999");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
  });

  it("returns 400 for an id that cannot name a row", async () => {
    const response = await request(createApp()).get("/api/users/abc");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "id must be a positive integer" });
  });
});

describe("GET /api/users/:id/tasks", () => {
  it("returns the member's tasks, newest updated first, with project names", async () => {
    const response = await request(createApp()).get("/api/users/3/tasks");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
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
    const response = await request(createApp()).get("/api/users/1/tasks");

    expect(response.body.map((task: { id: number }) => task.id)).toEqual([
      101, 105,
    ]);
  });

  it("returns an empty list for a member with no tasks", async () => {
    const response = await request(createApp()).get("/api/users/999/tasks");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe("POST /api/users", () => {
  it("creates the member and redirects to their page", async () => {
    const response = await request(createApp()).post("/api/users").send({
      name: "New Person",
      email: "new@example.test",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      ok: true,
      message: "User created.",
      redirectTo: "/users/4",
    });

    const detail = await request(createApp()).get("/api/users/4");

    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: 4,
      name: "New Person",
      email: "new@example.test",
    });
  });

  it("reports the reference's field errors for an invalid body", async () => {
    const response = await request(createApp()).post("/api/users").send({
      name: "Bad Email",
      email: "not-an-address",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to create user.",
      errors: { email: ["Enter a valid email address."] },
    });
  });

  it("reports an omitted name exactly as the reference's form does", async () => {
    const response = await request(createApp())
      .post("/api/users")
      .send({ email: "new@example.test" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to create user.",
      errors: { name: ["Invalid input: expected string, received null"] },
    });
  });
});

describe("PATCH /api/users/:id", () => {
  it("updates the member and redirects to their page", async () => {
    const response = await request(createApp()).patch("/api/users/1").send({
      name: "Robin Andrew (contractor)",
      email: "robin@example.test",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      message: "User updated.",
      redirectTo: "/users/1",
    });

    const detail = await request(createApp()).get("/api/users/1");

    expect(detail.body).toMatchObject({
      id: 1,
      name: "Robin Andrew (contractor)",
    });
  });

  it("returns the reference's 404 message for an unknown member", async () => {
    const response = await request(createApp())
      .patch("/api/users/999")
      .send({ name: "No such", email: "nobody@example.test" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "That user no longer exists." });
  });
});

describe("DELETE /api/users/:id", () => {
  it("deletes a member with no comments, unassigning their tasks", async () => {
    // Sam (3) has no comments but two tasks; tasks.assignee_id is ON DELETE
    // SET NULL, so the delete succeeds and unassigns rather than blocking.
    const response = await request(createApp()).delete("/api/users/3");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      message: "User deleted.",
      redirectTo: "/users",
    });

    const detail = await request(createApp()).get("/api/users/3");

    expect(detail.status).toBe(404);

    // The tasks survive, unassigned.
    const task103 = await request(createApp()).get("/api/tasks/103");

    expect(task103.body).toMatchObject({ id: 103, assigneeName: "Unassigned" });
  });

  it("refuses a member who authored comments, with the reference's guard", async () => {
    // Alex (2) wrote two comments and has two tasks; the comment count is what
    // blocks the delete (RESTRICT), the task count is context (SET NULL).
    const response = await request(createApp()).delete("/api/users/2");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error:
        "This person still has 2 comments and 2 tasks. Remove the comments before deleting.",
    });

    // The refused delete changed nothing.
    const detail = await request(createApp()).get("/api/users/2");

    expect(detail.status).toBe(200);
  });

  it("returns the reference's 404 message for an unknown member", async () => {
    const response = await request(createApp()).delete("/api/users/999");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "That user no longer exists." });
  });
});
