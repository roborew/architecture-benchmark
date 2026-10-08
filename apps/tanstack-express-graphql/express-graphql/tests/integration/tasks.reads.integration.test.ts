// tests/integration/tasks.reads.integration.test.ts
//
// The tasks read surface — the reads behind the All tasks listing page and the
// task detail page. Exercises the full stack (POST /graphql → resolvers →
// models → Postgres) through supertest against the seeded test database, and
// asserts the exact rows the shared fixture produces so a SQL drift is caught
// here, not in the browser.
//
// The row shape and ordering mirror the reference variant's workspace-wide
// task list (newest updated first, `updated_at DESC, id DESC`, the shared task
// projection with the project name and the coalesced assignee name), plus the
// keyset cursor columns the contract carries on every row (`updatedAtRaw`/
// `cursorFor`, the raw `(updated_at, id)` tuple the next page starts after).
//
// Every argument travels as a variable — a value never appears in the query
// text — and every refusal is HTTP 200 with the error inside `errors`: the
// old 400 `{ error: "..." }` envelopes are now `errors[0].message` with
// `extensions.code: "BAD_INPUT"`.

import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "../../src/app.ts";
import { encodeCursor } from "../../src/lib/cursor.ts";

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
// Expected rows, in updated_at DESC, id DESC order (the tasks contract):
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

// One document for every tasks read: all the filter and paging arguments are
// nullable variables, so the same document serves the unfiltered first page
// and every filtered or paged variant.
const TASKS_QUERY = `
  query Tasks(
    $q: String
    $status: String
    $projectId: Int
    $assigneeId: Int
    $cursor: String
    $limit: Int
  ) {
    tasks(
      q: $q
      status: $status
      projectId: $projectId
      assigneeId: $assigneeId
      cursor: $cursor
      limit: $limit
    ) {
      id
      projectId
      projectName
      title
      description
      status
      assigneeName
      commentCount
      updatedAt
      updatedAtRaw
      cursorFor
    }
  }
`;

const TASK_COUNT_QUERY = `
  query TaskCount($q: String, $status: String, $projectId: Int, $assigneeId: Int) {
    taskCount(q: $q, status: $status, projectId: $projectId, assigneeId: $assigneeId)
  }
`;

const TASK_QUERY = `
  query Task($id: Int!) {
    task(id: $id) {
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

const TASK_COMMENTS_QUERY = `
  query TaskComments($taskId: Int!) {
    taskComments(taskId: $taskId) {
      id
      taskId
      authorName
      body
      createdAt
    }
  }
`;

function gql(
  app: Express,
  query: string,
  variables: Record<string, unknown> = {},
) {
  return request(app).post("/graphql").send({ query, variables });
}

describe("query tasks", () => {
  it("returns 200 with a JSON body and an array under data", async () => {
    const response = await gql(createApp(), TASKS_QUERY);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(Array.isArray(response.body.data.tasks)).toBe(true);
  });

  it("returns exactly the seeded tasks, aggregate columns and cursor fields", async () => {
    const response = await gql(createApp(), TASKS_QUERY);

    // toEqual (not toMatchObject): the row shape is the API contract — an
    // extra or missing key is a breaking change for the client that renders it.
    expect(response.body.data.tasks).toEqual(EXPECTED_TASKS);
  });

  it("returns the whole fixture as the first page (25 is the default limit)", async () => {
    const response = await gql(createApp(), TASKS_QUERY);

    // Six seeded rows, one page: the default limit only shows once the fixture
    // outgrows it, which the paging tests below cover with an explicit limit.
    expect(response.body.data.tasks).toHaveLength(6);
  });

  it("orders tasks by most recently updated, then id descending", async () => {
    const response = await gql(createApp(), TASKS_QUERY);

    expect(response.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      101, 102, 105, 103, 104, 106,
    ]);
  });

  it("counts the comments each task carries across the join", async () => {
    const response = await gql(createApp(), TASKS_QUERY);

    const byTitle = new Map(
      response.body.data.tasks.map((task: { title: string }) => [
        task.title,
        task,
      ]),
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
    const response = await gql(createApp(), TASKS_QUERY);

    const statuses = response.body.data.tasks.map(
      (task: { status: string }) => task.status,
    );

    // The stored values are the contract (spec/contract.md): no display mapping.
    expect(statuses).toContain("in progress");
    expect(statuses).toContain("done");
    expect(statuses).toContain("todo");
  });

  it("matches a task title case-insensitively", async () => {
    const response = await gql(createApp(), TASKS_QUERY, { q: "NAVIGATION" });

    expect(response.body.data.tasks).toHaveLength(1);
    expect(response.body.data.tasks[0]).toMatchObject({
      id: 101,
      title: "Draft navigation model",
    });
  });

  it("matches on description as well as title", async () => {
    // "expectations" appears only in task 104's description, in no title.
    const response = await gql(createApp(), TASKS_QUERY, {
      q: "expectations",
    });

    expect(response.body.data.tasks).toHaveLength(1);
    expect(response.body.data.tasks[0]).toMatchObject({ id: 104 });
  });

  it("returns an empty array for a term that matches no task", async () => {
    const response = await gql(createApp(), TASKS_QUERY, {
      q: "no-such-task",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.tasks).toEqual([]);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    // A bare `%` would otherwise match every row and hide a real escaping bug.
    const percent = await gql(createApp(), TASKS_QUERY, { q: "%" });
    const underscore = await gql(createApp(), TASKS_QUERY, { q: "_" });

    expect(percent.body.data.tasks).toEqual([]);
    expect(underscore.body.data.tasks).toEqual([]);
  });

  it("ignores surrounding whitespace", async () => {
    // The REST suite had to percent-encode the spaces into the URL; a
    // variable carries the term verbatim.
    const response = await gql(createApp(), TASKS_QUERY, {
      q: "  Draft navigation model  ",
    });

    expect(response.body.data.tasks).toHaveLength(1);
    expect(response.body.data.tasks[0]).toMatchObject({ id: 101 });
  });

  it("filters by status", async () => {
    const todo = await gql(createApp(), TASKS_QUERY, { status: "todo" });
    const done = await gql(createApp(), TASKS_QUERY, { status: "done" });

    expect(todo.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      102, 104, 106,
    ]);
    expect(done.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      103,
    ]);
  });

  it("filters by project and by assignee", async () => {
    const project = await gql(createApp(), TASKS_QUERY, { projectId: 1 });
    const assignee = await gql(createApp(), TASKS_QUERY, { assigneeId: 1 });

    expect(project.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      101, 102, 103,
    ]);
    expect(assignee.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      101, 105,
    ]);
  });

  it("combines filters with the search term", async () => {
    const response = await gql(createApp(), TASKS_QUERY, {
      q: "navigation",
      status: "todo",
    });

    expect(response.body.data.tasks).toEqual([]);
  });

  it("answers BAD_INPUT with the reference's message for an unknown status", async () => {
    const response = await gql(createApp(), TASKS_QUERY, { status: "bogus" });

    // The old 400 `{ error: "Unknown task status: bogus" }`: HTTP is 200, the
    // data is gone, and the error carries the same message under BAD_INPUT.
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Unknown task status: bogus",
      extensions: { code: "BAD_INPUT" },
    });
  });

  it("answers BAD_INPUT when q is longer than 100 characters", async () => {
    const response = await gql(createApp(), TASKS_QUERY, {
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

describe("query tasks (keyset paging)", () => {
  it("limits the page to the requested size", async () => {
    const response = await gql(createApp(), TASKS_QUERY, { limit: 3 });

    expect(response.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      101, 102, 105,
    ]);
  });

  it("clamps a zero or negative limit to one row, like the reference", async () => {
    // An Int variable carries the 0 and the -7 the REST ?limit=0 / ?limit=-7
    // carried; the model clamps both to one row.
    const zero = await gql(createApp(), TASKS_QUERY, { limit: 0 });
    const negative = await gql(createApp(), TASKS_QUERY, { limit: -7 });

    expect(zero.body.data.tasks).toHaveLength(1);
    expect(negative.body.data.tasks).toHaveLength(1);
  });

  it("clamps an oversized limit to 26, the reference's page ceiling", async () => {
    const response = await gql(createApp(), TASKS_QUERY, { limit: 100 });

    // Six seeded rows: the clamp only shows once the fixture outgrows it.
    expect(response.body.data.tasks).toHaveLength(6);
  });

  it("follows a cursor onto the older page", async () => {
    const first = await gql(createApp(), TASKS_QUERY, { limit: 3 });
    const cursor = first.body.data.tasks[2].cursorFor;

    const second = await gql(createApp(), TASKS_QUERY, { limit: 3, cursor });

    expect(second.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      103, 104, 106,
    ]);
  });

  it("is stable and repeatable: the same cursor yields the same page", async () => {
    const first = await gql(createApp(), TASKS_QUERY, { limit: 2 });
    const cursor = first.body.data.tasks[1].cursorFor;

    // spec/queries.md: the cursor "must be stable and repeatable".
    const second = await gql(createApp(), TASKS_QUERY, { limit: 2, cursor });
    const third = await gql(createApp(), TASKS_QUERY, { limit: 2, cursor });

    expect(second.body.data).toEqual(third.body.data);
    expect(second.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      105, 103,
    ]);
  });

  it("reads the first page for a cursor nothing could have produced", async () => {
    // A malformed or hand-edited cursor decodes to nothing, which the
    // reference turns into the first page rather than an error.
    const response = await gql(createApp(), TASKS_QUERY, {
      cursor: "not-a-cursor",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      101, 102, 105, 103, 104, 106,
    ]);
  });

  it("keeps the filters while paging", async () => {
    const first = await gql(createApp(), TASKS_QUERY, {
      status: "todo",
      limit: 2,
    });
    const cursor = first.body.data.tasks[1].cursorFor;

    const second = await gql(createApp(), TASKS_QUERY, {
      status: "todo",
      limit: 2,
      cursor,
    });

    expect(first.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      102, 104,
    ]);
    expect(second.body.data.tasks.map((task: { id: number }) => task.id)).toEqual([
      106,
    ]);
  });
});

describe("query taskCount", () => {
  it("counts every seeded task with no filters", async () => {
    const response = await gql(createApp(), TASK_COUNT_QUERY);

    // The old REST count answered `{ count: 6 }`; the Int is the whole reply.
    expect(response.status).toBe(200);
    expect(response.body.data.taskCount).toBe(6);
  });

  it("counts the tasks matching each filter", async () => {
    const search = await gql(createApp(), TASK_COUNT_QUERY, { q: "navigation" });
    const status = await gql(createApp(), TASK_COUNT_QUERY, {
      status: "todo",
    });
    const project = await gql(createApp(), TASK_COUNT_QUERY, { projectId: 1 });
    const assignee = await gql(createApp(), TASK_COUNT_QUERY, {
      assigneeId: 1,
    });

    expect(search.body.data.taskCount).toBe(1);
    expect(status.body.data.taskCount).toBe(3);
    expect(project.body.data.taskCount).toBe(3);
    expect(assignee.body.data.taskCount).toBe(2);
  });

  it("shares the list's status rejection", async () => {
    const response = await gql(createApp(), TASK_COUNT_QUERY, {
      status: "bogus",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Unknown task status: bogus",
      extensions: { code: "BAD_INPUT" },
    });
  });
});

describe("query task", () => {
  it("returns exactly the task row, without the cursor fields", async () => {
    const response = await gql(createApp(), TASK_QUERY, { id: 101 });

    // A single row by primary key has no cursor to build, so the detail row is
    // the shared projection verbatim.
    expect(response.status).toBe(200);
    expect(response.body.data.task).toEqual({
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

  it("answers NOT_FOUND for an unknown id", async () => {
    const response = await gql(createApp(), TASK_QUERY, { id: 999 });

    // The old plain 404 envelope: the message is "Not found", and the code is
    // what the SPA's api client maps back to 404.
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Not found",
      extensions: { code: "NOT_FOUND" },
    });
  });

  it("answers BAD_INPUT for an id that cannot name a row", async () => {
    // The REST guard rejected "/api/tasks/abc" with this message; GraphQL's
    // Int! argument reaches the same guard with a non-positive integer.
    const response = await gql(createApp(), TASK_QUERY, { id: 0 });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "id must be a positive integer",
      extensions: { code: "BAD_INPUT" },
    });
  });
});

describe("query taskComments", () => {
  it("returns the task's comments, newest first, with author names", async () => {
    const response = await gql(createApp(), TASK_COMMENTS_QUERY, {
      taskId: 101,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.taskComments).toEqual([
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
    const response = await gql(createApp(), TASK_COMMENTS_QUERY, {
      taskId: 106,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.taskComments).toEqual([]);
  });
});
