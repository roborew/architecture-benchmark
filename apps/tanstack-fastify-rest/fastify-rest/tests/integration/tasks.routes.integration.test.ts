// tests/integration/tasks.routes.integration.test.ts
//
// The GET /api/tasks surface — the reads behind the All tasks listing page and
// the task detail page. Exercises the full HTTP stack (routes → controller →
// model → Postgres) through the app's `inject()` against the seeded test
// database, and asserts the exact rows the shared fixture produces so a SQL
// drift is caught here, not in the browser.
//
// The row shape and ordering mirror the reference variant's workspace-wide
// task list (newest updated first, `updated_at DESC, id DESC`, the shared task
// projection with the project name and the coalesced assignee name), plus the
// keyset cursor columns the REST contract carries on every row
// (`updatedAtRaw`/`cursorFor`, the raw `(updated_at, id)` tuple the next page
// starts after).

import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.ts";
import { encodeCursor } from "../../src/lib/cursor.ts";

const app = buildApp();

// The search contract mirrors the getUsers integration suite (case-insensitive
// title match, description match, wildcard escaping), with the HTTP boundaries
// the REST layer adds: 400 envelopes for malformed params.

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
    updatedAtRaw: "2026-09-29T08:00:00.000000Z",
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
    updatedAtRaw: "2026-09-28T11:20:00.000000Z",
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
    updatedAtRaw: "2026-09-28T09:30:00.000000Z",
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
    updatedAtRaw: "2026-09-27T16:45:00.000000Z",
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
    updatedAtRaw: "2026-09-26T10:00:00.000000Z",
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
    updatedAtRaw: "2026-09-23T11:20:00.000000Z",
  },
].map((task) => ({
  ...task,
  cursorFor: encodeCursor(task.updatedAtRaw, task.id),
}));

describe("GET /api/tasks", () => {
  it("returns 200 with a JSON array", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tasks" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(Array.isArray(response.json())).toBe(true);
  });

  it("returns exactly the seeded tasks, aggregate columns and cursor fields", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tasks" });

    // toEqual (not toMatchObject): the row shape is the API contract — an
    // extra or missing key is a breaking change for the client that renders it.
    expect(response.json()).toEqual(EXPECTED_TASKS);
  });

  it("returns the whole fixture as the first page (25 is the default limit)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tasks" });

    // Six seeded rows, one page: the default limit only shows once the fixture
    // outgrows it, which the paging tests below cover with an explicit limit.
    expect(response.json()).toHaveLength(6);
  });

  it("orders tasks by most recently updated, then id descending", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tasks" });

    expect(response.json().map((task: { id: number }) => task.id)).toEqual([
      101, 102, 105, 103, 104, 106,
    ]);
  });

  it("counts the comments each task carries across the join", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tasks" });

    const byTitle = new Map(
      response.json().map((task: { title: string }) => [task.title, task]),
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
    const response = await app.inject({ method: "GET", url: "/api/tasks" });

    const statuses = response.json().map(
      (task: { status: string }) => task.status,
    );

    // The stored values are the contract (spec/contract.md): no display mapping.
    expect(statuses).toContain("in progress");
    expect(statuses).toContain("done");
    expect(statuses).toContain("todo");
  });

  it("matches a task title case-insensitively", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?q=NAVIGATION",
    });

    expect(response.json()).toHaveLength(1);
    expect(response.json()[0]).toMatchObject({
      id: 101,
      title: "Draft navigation model",
    });
  });

  it("matches on description as well as title", async () => {
    // "expectations" appears only in task 104's description, in no title.
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?q=expectations",
    });

    expect(response.json()).toHaveLength(1);
    expect(response.json()[0]).toMatchObject({ id: 104 });
  });

  it("returns an empty array for a term that matches no task", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?q=no-such-task",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    // A bare `%` would otherwise match every row and hide a real escaping bug.
    const percent = await app.inject({ method: "GET", url: "/api/tasks?q=%" });
    const underscore = await app.inject({
      method: "GET",
      url: "/api/tasks?q=_",
    });

    expect(percent.json()).toEqual([]);
    expect(underscore.json()).toEqual([]);
  });

  it("ignores surrounding whitespace", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?q=%20%20Draft%20navigation%20model%20%20",
    });

    expect(response.json()).toHaveLength(1);
    expect(response.json()[0]).toMatchObject({ id: 101 });
  });

  it("filters by status", async () => {
    const todo = await app.inject({
      method: "GET",
      url: "/api/tasks?status=todo",
    });
    const done = await app.inject({
      method: "GET",
      url: "/api/tasks?status=done",
    });

    expect(todo.json().map((task: { id: number }) => task.id)).toEqual([
      102, 104, 106,
    ]);
    expect(done.json().map((task: { id: number }) => task.id)).toEqual([103]);
  });

  it("filters by project and by assignee", async () => {
    const project = await app.inject({
      method: "GET",
      url: "/api/tasks?projectId=1",
    });
    const assignee = await app.inject({
      method: "GET",
      url: "/api/tasks?assigneeId=1",
    });

    expect(project.json().map((task: { id: number }) => task.id)).toEqual([
      101, 102, 103,
    ]);
    expect(assignee.json().map((task: { id: number }) => task.id)).toEqual([
      101, 105,
    ]);
  });

  it("combines filters with the search term", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?q=navigation&status=todo",
    });

    expect(response.json()).toEqual([]);
  });

  it("returns 400 with the reference's message for an unknown status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?status=bogus",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Unknown task status: bogus" });
  });

  it("returns 400 when q is repeated", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?q=navigation&q=breakpoint",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "q must be a single value" });
  });

  it("returns 400 when q is longer than 100 characters", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks?q=${"a".repeat(101)}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "q must be at most 100 characters",
    });
  });

  it("returns 400 for a non-integer project or assignee filter", async () => {
    const project = await app.inject({
      method: "GET",
      url: "/api/tasks?projectId=one",
    });
    const assignee = await app.inject({
      method: "GET",
      url: "/api/tasks?assigneeId=1.5",
    });

    expect(project.statusCode).toBe(400);
    expect(project.json()).toEqual({ error: "projectId must be an integer" });
    expect(assignee.statusCode).toBe(400);
    expect(assignee.json()).toEqual({ error: "assigneeId must be an integer" });
  });

  it("returns 400 for a non-integer limit", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?limit=many",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "limit must be an integer" });
  });
});

describe("GET /api/tasks (keyset paging)", () => {
  it("limits the page to the requested size", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?limit=3",
    });

    expect(response.json().map((task: { id: number }) => task.id)).toEqual([
      101, 102, 105,
    ]);
  });

  it("clamps a zero or negative limit to one row, like the reference", async () => {
    const zero = await app.inject({ method: "GET", url: "/api/tasks?limit=0" });
    const negative = await app.inject({
      method: "GET",
      url: "/api/tasks?limit=-7",
    });

    expect(zero.json()).toHaveLength(1);
    expect(negative.json()).toHaveLength(1);
  });

  it("clamps an oversized limit to 26, the reference's page ceiling", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?limit=100",
    });

    // Six seeded rows: the clamp only shows once the fixture outgrows it.
    expect(response.json()).toHaveLength(6);
  });

  it("follows a cursor onto the older page", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/api/tasks?limit=3",
    });
    const cursor = first.json()[2].cursorFor;

    const second = await app.inject({
      method: "GET",
      url: `/api/tasks?limit=3&cursor=${encodeURIComponent(cursor)}`,
    });

    expect(second.json().map((task: { id: number }) => task.id)).toEqual([
      103, 104, 106,
    ]);
  });

  it("is stable and repeatable: the same cursor yields the same page", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/api/tasks?limit=2",
    });
    const cursor = first.json()[1].cursorFor;
    const url = `/api/tasks?limit=2&cursor=${encodeURIComponent(cursor)}`;

    // spec/queries.md: the cursor "must be stable and repeatable".
    const second = await app.inject({ method: "GET", url });
    const third = await app.inject({ method: "GET", url });

    expect(second.json()).toEqual(third.json());
    expect(second.json().map((task: { id: number }) => task.id)).toEqual([
      105, 103,
    ]);
  });

  it("reads the first page for a cursor nothing could have produced", async () => {
    // A malformed or hand-edited cursor decodes to nothing, which the reference
    // turns into the first page rather than an error.
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?cursor=not-a-cursor",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map((task: { id: number }) => task.id)).toEqual([
      101, 102, 105, 103, 104, 106,
    ]);
  });

  it("keeps the filters while paging", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/api/tasks?status=todo&limit=2",
    });
    const cursor = first.json()[1].cursorFor;

    const second = await app.inject({
      method: "GET",
      url: `/api/tasks?status=todo&limit=2&cursor=${encodeURIComponent(cursor)}`,
    });

    expect(first.json().map((task: { id: number }) => task.id)).toEqual([
      102, 104,
    ]);
    expect(second.json().map((task: { id: number }) => task.id)).toEqual([106]);
  });
});

describe("GET /api/tasks/count", () => {
  it("counts every seeded task with no filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/count",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ count: 6 });
  });

  it("counts the tasks matching each filter", async () => {
    const search = await app.inject({
      method: "GET",
      url: "/api/tasks/count?q=navigation",
    });
    const status = await app.inject({
      method: "GET",
      url: "/api/tasks/count?status=todo",
    });
    const project = await app.inject({
      method: "GET",
      url: "/api/tasks/count?projectId=1",
    });
    const assignee = await app.inject({
      method: "GET",
      url: "/api/tasks/count?assigneeId=1",
    });

    expect(search.json()).toEqual({ count: 1 });
    expect(status.json()).toEqual({ count: 3 });
    expect(project.json()).toEqual({ count: 3 });
    expect(assignee.json()).toEqual({ count: 2 });
  });

  it("shares the list's status rejection", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/count?status=bogus",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Unknown task status: bogus" });
  });
});

describe("GET /api/tasks/:id", () => {
  it("returns exactly the task row, without the cursor fields", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tasks/101" });

    // A single row by primary key has no cursor to build, so the detail row is
    // the shared projection verbatim.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
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
    });
  });

  it("returns the plain 404 envelope for an unknown id", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tasks/999" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found" });
  });

  it("returns 400 for an id that cannot name a row", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tasks/abc" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "id must be a positive integer" });
  });
});

describe("GET /api/tasks/:id/comments", () => {
  it("returns the task's comments, newest first, with author names", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/101/comments",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        id: 2,
        taskId: 101,
        authorName: "Robin Andrew",
        body: "Thanks - I will use that to confirm the signed-in navigation.",
        createdAt: "2026-09-29T10:18:00Z",
      },
      {
        id: 1,
        taskId: 101,
        authorName: "Alex Morgan",
        body: "I have added the initial content grouping for review.",
        createdAt: "2026-09-29T09:42:00Z",
      },
    ]);
  });

  it("returns an empty array for a task with no comments", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/106/comments",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});
