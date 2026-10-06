// tests/integration/users.routes.integration.test.ts
//
// GET /api/users — the read behind the People listing page. Exercises the full
// HTTP stack (routes → controller → model → Postgres) through supertest
// against the seeded test database, and asserts the exact rows the shared
// fixture produces so a SQL drift is caught here, not in the browser.

import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/app.ts";

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
});
