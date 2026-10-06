// tests/integration/users.routes.integration.test.ts
//
// GET /api/users — the read behind the People listing page. Exercises the full
// HTTP stack (routes → controller → model → Postgres) through supertest
// against the seeded test database, and asserts the exact rows the shared
// fixture produces so a SQL drift is caught here, not in the browser.

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
