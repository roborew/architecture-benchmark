// tests/integration/tasks.routes.integration.test.ts
//
// GET /api/tasks — the read behind the All tasks listing page. Exercises the
// full HTTP stack (routes → controller → model → Postgres) through supertest
// against the seeded test database, and asserts the exact rows the shared
// fixture produces so a SQL drift is caught here, not in the browser.
//
// The row shape and ordering mirror the reference variant's workspace-wide
// task list (newest updated first, `updated_at DESC, id DESC`, the shared task
// projection with the project name and the coalesced assignee name).

import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/app.ts";

// The search contract mirrors the getUsers integration suite (case-insensitive
// title match, description match, wildcard escaping), with the HTTP boundaries
// the REST layer adds: 400 envelopes for malformed q.

// The seeded fixture (spec/snapshots/correctness), worked through by hand:
//
//   users    1 Robin Andrew, 2 Alex Morgan, 3 Sam Taylor
//   projects 1 Website redesign, 2 Mobile application, 3 Platform migration
//   tasks    101 (p1, u1, in progress, updated 09-29T08:00)
//            102 (p1, u2, todo,          updated 09-28T11:20)
//            103 (p1, u3, done,          updated 09-27T16:45)
//            104 (p2, u2, todo,          updated 09-26T10:00)
//            105 (p2, u1, in progress,   updated 09-28T09:30)
//            106 (p3, u3, todo,          updated 09-23T11:20)
//   comments 1, 2 → task 101; 3 → task 104
//
// Expected rows, in updated_at DESC, id DESC order (the getTasks contract):
const EXPECTED_TASKS = [
  {
    id: 101,
    projectId: 1,
    projectName: "Website redesign",
    title: "Draft navigation model",
    description:
      "Map the navigation structure for the public and authenticated product areas.",
    status: "in progress",
    assigneeName: "Robin Andrew",
    commentCount: 2,
    updatedAt: "2026-09-29T08:00:00Z",
  },
  {
    id: 102,
    projectId: 1,
    projectName: "Website redesign",
    title: "Confirm breakpoint rules",
    description:
      "Agree the breakpoints the shared layout tokens are generated from.",
    status: "todo",
    assigneeName: "Alex Morgan",
    commentCount: 0,
    updatedAt: "2026-09-28T11:20:00Z",
  },
  {
    id: 105,
    projectId: 2,
    projectName: "Mobile application",
    title: "Build profile screen",
    description: "Implement the profile screen for existing workspace members.",
    status: "in progress",
    assigneeName: "Robin Andrew",
    commentCount: 0,
    updatedAt: "2026-09-28T09:30:00Z",
  },
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
    id: 104,
    projectId: 2,
    projectName: "Mobile application",
    title: "Review API response shapes",
    description:
      "Check the client expectations against the shapes the service returns.",
    status: "todo",
    assigneeName: "Alex Morgan",
    commentCount: 1,
    updatedAt: "2026-09-26T10:00:00Z",
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
];

describe("GET /api/tasks", () => {
  it("returns 200 with a JSON array", async () => {
    const response = await request(createApp()).get("/api/tasks");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it("returns exactly the seeded tasks and aggregate columns", async () => {
    const response = await request(createApp()).get("/api/tasks");

    // toEqual (not toMatchObject): the row shape is the API contract — an
    // extra or missing key is a breaking change for the client that renders it.
    expect(response.body).toEqual(EXPECTED_TASKS);
  });

  it("orders tasks by most recently updated, then id descending", async () => {
    const response = await request(createApp()).get("/api/tasks");

    expect(response.body.map((task: { id: number }) => task.id)).toEqual([
      101, 102, 105, 103, 104, 106,
    ]);
  });

  it("counts the comments each task carries across the join", async () => {
    const response = await request(createApp()).get("/api/tasks");

    const byTitle = new Map(
      response.body.map((task: { title: string }) => [task.title, task]),
    );

    // Task 101 has two comments and a single assignee; the project and assignee
    // joins must not multiply its comment count.
    expect(byTitle.get("Draft navigation model")).toMatchObject({
      assigneeName: "Robin Andrew",
      projectName: "Website redesign",
      commentCount: 2,
    });
    expect(byTitle.get("Review API response shapes")).toMatchObject({
      commentCount: 1,
    });
    expect(byTitle.get("Write migration checklist")).toMatchObject({
      commentCount: 0,
    });
  });

  it("renders the stored status values without translation", async () => {
    const response = await request(createApp()).get("/api/tasks");

    const statuses = response.body.map(
      (task: { status: string }) => task.status,
    );

    // The stored values are the contract (spec/contract.md): no display mapping.
    expect(statuses).toContain("in progress");
    expect(statuses).toContain("done");
    expect(statuses).toContain("todo");
  });

  it("matches a task title case-insensitively", async () => {
    const response = await request(createApp()).get("/api/tasks?q=NAVIGATION");

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: 101,
      title: "Draft navigation model",
    });
  });

  it("matches on description as well as title", async () => {
    // "expectations" appears only in task 104's description, in no title.
    const response = await request(createApp()).get("/api/tasks?q=expectations");

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: 104 });
  });

  it("returns an empty array for a term that matches no task", async () => {
    const response = await request(createApp()).get("/api/tasks?q=no-such-task");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    // A bare `%` would otherwise match every row and hide a real escaping bug.
    const percent = await request(createApp()).get("/api/tasks?q=%");
    const underscore = await request(createApp()).get("/api/tasks?q=_");

    expect(percent.body).toEqual([]);
    expect(underscore.body).toEqual([]);
  });

  it("ignores surrounding whitespace", async () => {
    const response = await request(createApp()).get(
      "/api/tasks?q=%20%20Draft%20navigation%20model%20%20",
    );

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: 101 });
  });

  it("returns 400 when q is repeated", async () => {
    const response = await request(createApp()).get(
      "/api/tasks?q=navigation&q=breakpoint",
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "q must be a single value" });
  });

  it("returns 400 when q is longer than 100 characters", async () => {
    const response = await request(createApp()).get(
      `/api/tasks?q=${"a".repeat(101)}`,
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "q must be at most 100 characters",
    });
  });
});
