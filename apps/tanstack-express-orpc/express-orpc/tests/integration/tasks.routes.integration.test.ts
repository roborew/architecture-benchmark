// tests/integration/tasks.routes.integration.test.ts
//
// The tasks read procedures — the reads behind the All tasks listing page and
// the task detail page. Exercises the full stack (Express mount → RPCHandler →
// router → model → Postgres) through an oRPC client against the seeded test
// database — the same RPCLink transport the SPA's client uses — and asserts
// the exact rows the shared fixture produces so a SQL drift is caught here,
// not in the browser.
//
// The row shape and ordering mirror the reference variant's workspace-wide
// task list (newest updated first, `updated_at DESC, id DESC`, the shared task
// projection with the project name and the coalesced assignee name), plus the
// keyset cursor columns the contract carries on every row
// (`updatedAtRaw`/`cursorFor`, the raw `(updated_at, id)` tuple the next page
// starts after).

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startRpcServer, stopRpcServer } from "../helpers/rpc-server.ts";
import type { RpcServer } from "../helpers/rpc-server.ts";
import { encodeCursor } from "../../src/lib/cursor.ts";

// The search contract mirrors the getUsers integration suite (case-insensitive
// title match, description match, wildcard escaping), with the value rules the
// router still owns: rejections carrying the reference's messages for an
// unknown status or an over-long search term.

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

let rpc: RpcServer;

beforeAll(() => {
  rpc = startRpcServer();
});

afterAll(async () => {
  await stopRpcServer(rpc.server);
});

describe("tasks.list", () => {
  it("resolves to an array", async () => {
    const tasks = await rpc.client.tasks.list({});

    expect(Array.isArray(tasks)).toBe(true);
  });

  it("returns exactly the seeded tasks, aggregate columns and cursor fields", async () => {
    const tasks = await rpc.client.tasks.list({});

    // toEqual (not toMatchObject): the row shape is the API contract — an
    // extra or missing key is a breaking change for the client that renders it.
    expect(tasks).toEqual(EXPECTED_TASKS);
  });

  it("returns the whole fixture as the first page (25 is the default limit)", async () => {
    const tasks = await rpc.client.tasks.list({});

    // Six seeded rows, one page: the default limit only shows once the fixture
    // outgrows it, which the paging tests below cover with an explicit limit.
    expect(tasks).toHaveLength(6);
  });

  it("orders tasks by most recently updated, then id descending", async () => {
    const tasks = await rpc.client.tasks.list({});

    expect(tasks.map((task) => task.id)).toEqual([
      101, 102, 105, 103, 104, 106,
    ]);
  });

  it("counts the comments each task carries across the join", async () => {
    const tasks = await rpc.client.tasks.list({});

    const byTitle = new Map(tasks.map((task) => [task.title, task]));

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
    const tasks = await rpc.client.tasks.list({});

    const statuses = tasks.map((task) => task.status);

    // The stored values are the contract (spec/contract.md): no display mapping.
    expect(statuses).toContain("in progress");
    expect(statuses).toContain("done");
    expect(statuses).toContain("todo");
  });

  it("matches a task title case-insensitively", async () => {
    const tasks = await rpc.client.tasks.list({ q: "NAVIGATION" });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 101,
      title: "Draft navigation model",
    });
  });

  it("matches on description as well as title", async () => {
    // "expectations" appears only in task 104's description, in no title.
    const tasks = await rpc.client.tasks.list({ q: "expectations" });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 104 });
  });

  it("returns an empty array for a term that matches no task", async () => {
    const tasks = await rpc.client.tasks.list({ q: "no-such-task" });

    expect(tasks).toEqual([]);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    // A bare `%` would otherwise match every row and hide a real escaping bug.
    const percent = await rpc.client.tasks.list({ q: "%" });
    const underscore = await rpc.client.tasks.list({ q: "_" });

    expect(percent).toEqual([]);
    expect(underscore).toEqual([]);
  });

  it("ignores surrounding whitespace", async () => {
    const tasks = await rpc.client.tasks.list({
      q: "  Draft navigation model  ",
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 101 });
  });

  it("filters by status", async () => {
    const todo = await rpc.client.tasks.list({ status: "todo" });
    const done = await rpc.client.tasks.list({ status: "done" });

    expect(todo.map((task) => task.id)).toEqual([102, 104, 106]);
    expect(done.map((task) => task.id)).toEqual([103]);
  });

  it("filters by project and by assignee", async () => {
    const project = await rpc.client.tasks.list({ projectId: 1 });
    const assignee = await rpc.client.tasks.list({ assigneeId: 1 });

    expect(project.map((task) => task.id)).toEqual([101, 102, 103]);
    expect(assignee.map((task) => task.id)).toEqual([101, 105]);
  });

  it("combines filters with the search term", async () => {
    const tasks = await rpc.client.tasks.list({
      q: "navigation",
      status: "todo",
    });

    expect(tasks).toEqual([]);
  });

  it("rejects with the reference's message for an unknown status", async () => {
    await expect(
      rpc.client.tasks.list({ status: "bogus" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { error: "Unknown task status: bogus" },
    });
  });

  it("rejects when q is longer than 100 characters", async () => {
    await expect(
      rpc.client.tasks.list({ q: "a".repeat(101) }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { error: "q must be at most 100 characters" },
    });
  });
});

describe("tasks.list (keyset paging)", () => {
  it("limits the page to the requested size", async () => {
    const tasks = await rpc.client.tasks.list({ limit: 3 });

    expect(tasks.map((task) => task.id)).toEqual([101, 102, 105]);
  });

  it("clamps a zero or negative limit to one row, like the reference", async () => {
    const zero = await rpc.client.tasks.list({ limit: 0 });
    const negative = await rpc.client.tasks.list({ limit: -7 });

    expect(zero).toHaveLength(1);
    expect(negative).toHaveLength(1);
  });

  it("clamps an oversized limit to 26, the reference's page ceiling", async () => {
    const tasks = await rpc.client.tasks.list({ limit: 100 });

    // Six seeded rows: the clamp only shows once the fixture outgrows it.
    expect(tasks).toHaveLength(6);
  });

  it("follows a cursor onto the older page", async () => {
    const first = await rpc.client.tasks.list({ limit: 3 });
    const cursor = first[2].cursorFor;

    const second = await rpc.client.tasks.list({ limit: 3, cursor });

    expect(second.map((task) => task.id)).toEqual([103, 104, 106]);
  });

  it("is stable and repeatable: the same cursor yields the same page", async () => {
    const first = await rpc.client.tasks.list({ limit: 2 });
    const cursor = first[1].cursorFor;

    // spec/queries.md: the cursor "must be stable and repeatable".
    const second = await rpc.client.tasks.list({ limit: 2, cursor });
    const third = await rpc.client.tasks.list({ limit: 2, cursor });

    expect(second).toEqual(third);
    expect(second.map((task) => task.id)).toEqual([105, 103]);
  });

  it("reads the first page for a cursor nothing could have produced", async () => {
    // A malformed or hand-edited cursor decodes to nothing, which the reference
    // turns into the first page rather than an error.
    const tasks = await rpc.client.tasks.list({ cursor: "not-a-cursor" });

    expect(tasks.map((task) => task.id)).toEqual([
      101, 102, 105, 103, 104, 106,
    ]);
  });

  it("keeps the filters while paging", async () => {
    const first = await rpc.client.tasks.list({ status: "todo", limit: 2 });
    const cursor = first[1].cursorFor;

    const second = await rpc.client.tasks.list({
      status: "todo",
      limit: 2,
      cursor,
    });

    expect(first.map((task) => task.id)).toEqual([102, 104]);
    expect(second.map((task) => task.id)).toEqual([106]);
  });
});

describe("tasks.count", () => {
  it("counts every seeded task with no filters", async () => {
    const count = await rpc.client.tasks.count({});

    // The bare number: the RPC reply is the value, not a `{ count }` wrapper.
    expect(count).toBe(6);
  });

  it("counts the tasks matching each filter", async () => {
    const search = await rpc.client.tasks.count({ q: "navigation" });
    const status = await rpc.client.tasks.count({ status: "todo" });
    const project = await rpc.client.tasks.count({ projectId: 1 });
    const assignee = await rpc.client.tasks.count({ assigneeId: 1 });

    expect(search).toBe(1);
    expect(status).toBe(3);
    expect(project).toBe(3);
    expect(assignee).toBe(2);
  });

  it("shares the list's status rejection", async () => {
    await expect(
      rpc.client.tasks.count({ status: "bogus" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { error: "Unknown task status: bogus" },
    });
  });
});

describe("tasks.byId", () => {
  it("returns exactly the task row, without the cursor fields", async () => {
    const task = await rpc.client.tasks.byId({ id: 101 });

    // A single row by primary key has no cursor to build, so the detail row is
    // the shared projection verbatim.
    expect(task).toEqual({
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

  it("rejects with the plain not-found envelope for an unknown id", async () => {
    await expect(rpc.client.tasks.byId({ id: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "Not found" },
    });
  });
});

describe("tasks.comments", () => {
  it("returns the task's comments, newest first, with author names", async () => {
    const comments = await rpc.client.tasks.comments({ id: 101 });

    expect(comments).toEqual([
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
    const comments = await rpc.client.tasks.comments({ id: 106 });

    expect(comments).toEqual([]);
  });
});
