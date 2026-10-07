// tests/integration/projects.routes.integration.test.ts
//
// The projects procedures — the reads behind the project listing and board
// pages, and the writes behind the project forms. Exercises the full stack
// (Express mount → RPCHandler → router → model → Postgres) through an oRPC
// client against the seeded test database — the same RPCLink transport the
// SPA's client uses — and asserts the exact rows the shared fixture produces
// so a SQL drift is caught here, not in the browser.
//
// The row shapes and orderings mirror the reference variant (getProjects,
// getProject, getProjectTasks), including the board's keyset paging over
// `(created_at, id)`.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startRpcServer, stopRpcServer } from "../helpers/rpc-server.ts";
import type { RpcServer } from "../helpers/rpc-server.ts";
import { encodeCursor } from "../../src/lib/cursor.ts";

// The seeded fixture (spec/snapshots/correctness), worked through by hand:
//
//   projects 1 Website redesign (created 09-27), 2 Mobile application (09-21),
//            3 Platform migration (09-12)
//   tasks     101, 102, 103 → project 1; 104, 105 → project 2; 106 → project 3
//
// Expected rows, in created_at DESC, id DESC order (the getProjects contract):
const EXPECTED_PROJECTS = [
  {
    id: 1,
    name: "Website redesign",
    description: "Refresh the public website and onboarding experience.",
    taskCount: 3,
    openTaskCount: 2, // 101 in progress, 102 todo; 103 is done
    peopleCount: 3, // assignees 1, 2 and 3
    createdAt: "2026-09-27",
  },
  {
    id: 2,
    name: "Mobile application",
    description:
      "Ship the first mobile experience for existing workspace members.",
    taskCount: 2,
    openTaskCount: 2, // 104 todo, 105 in progress
    peopleCount: 2, // assignees 1 and 2
    createdAt: "2026-09-21",
  },
  {
    id: 3,
    name: "Platform migration",
    description:
      "Move the service and supporting processes to the new platform.",
    taskCount: 1,
    openTaskCount: 1, // 106 todo
    peopleCount: 1, // assignee 3
    createdAt: "2026-09-12",
  },
];

// Project 1's board, in created_at DESC, id DESC order (getProjectTasks):
const PROJECT_1_TASKS = [
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
    createdAtRaw: "2026-09-28T10:15:00.000000Z",
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
    createdAtRaw: "2026-09-27T14:30:00.000000Z",
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
    createdAtRaw: "2026-09-26T09:05:00.000000Z",
  },
].map((task) => ({
  ...task,
  cursorFor: encodeCursor(task.createdAtRaw, task.id),
}));

let rpc: RpcServer;

beforeAll(() => {
  rpc = startRpcServer();
});

afterAll(async () => {
  await stopRpcServer(rpc.server);
});

describe("projects.list", () => {
  it("resolves to an array", async () => {
    const projects = await rpc.client.projects.list({});

    expect(Array.isArray(projects)).toBe(true);
  });

  it("returns exactly the seeded projects and aggregate columns", async () => {
    const projects = await rpc.client.projects.list({});

    // toEqual (not toMatchObject): the row shape is the API contract — an
    // extra or missing key is a breaking change for the client that renders it.
    expect(projects).toEqual(EXPECTED_PROJECTS);
  });

  it("orders projects by created_at descending, then id descending", async () => {
    const projects = await rpc.client.projects.list({});

    expect(projects.map((project) => project.id)).toEqual([1, 2, 3]);
  });

  it("matches a project name case-insensitively", async () => {
    const projects = await rpc.client.projects.list({ q: "REDESIGN" });

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: 1,
      name: "Website redesign",
    });
  });

  it("matches on description as well as name", async () => {
    // "platform" appears in project 3's description and its name; "onboarding"
    // only in project 1's description.
    const platform = await rpc.client.projects.list({ q: "platform" });
    const onboarding = await rpc.client.projects.list({ q: "onboarding" });

    expect(platform.map((project) => project.id)).toEqual([3]);
    expect(onboarding.map((project) => project.id)).toEqual([1]);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    const percent = await rpc.client.projects.list({ q: "%" });
    const underscore = await rpc.client.projects.list({ q: "_" });

    expect(percent).toEqual([]);
    expect(underscore).toEqual([]);
  });
});

describe("projects.byId", () => {
  it("returns exactly the project row", async () => {
    const project = await rpc.client.projects.byId({ id: 2 });

    expect(project).toEqual(EXPECTED_PROJECTS[1]);
  });

  it("rejects with the plain not-found envelope for an unknown id", async () => {
    await expect(rpc.client.projects.byId({ id: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "Not found" },
    });
  });
});

describe("projects.tasks", () => {
  it("returns the board's rows with their cursor fields", async () => {
    const tasks = await rpc.client.projects.tasks({ id: 1 });

    expect(tasks).toEqual(PROJECT_1_TASKS);
  });

  it("orders the board by created_at descending, then id descending", async () => {
    const tasks = await rpc.client.projects.tasks({ id: 1 });

    expect(tasks.map((task) => task.id)).toEqual([101, 102, 103]);
  });

  it("returns an empty board for an unknown project", async () => {
    // Mirror getProjectTasks: the board of a project that has no tasks — or
    // that no longer exists — is empty, not an error.
    const tasks = await rpc.client.projects.tasks({ id: 999 });

    expect(tasks).toEqual([]);
  });

  it("filters the board by status", async () => {
    const todo = await rpc.client.projects.tasks({ id: 1, status: "todo" });
    const done = await rpc.client.projects.tasks({ id: 1, status: "done" });

    expect(todo.map((task) => task.id)).toEqual([102]);
    expect(done.map((task) => task.id)).toEqual([103]);
  });

  it("rejects with the reference's message for an unknown status", async () => {
    await expect(
      rpc.client.projects.tasks({ id: 1, status: "shipped" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { error: "Unknown task status: shipped" },
    });
  });

  it("pages the board by keyset over (created_at, id)", async () => {
    const first = await rpc.client.projects.tasks({ id: 1, limit: 2 });

    expect(first.map((task) => task.id)).toEqual([101, 102]);

    // The last row's cursorFor is the (created_at, id) tuple the next page
    // starts after.
    const cursor = first[1].cursorFor;
    const second = await rpc.client.projects.tasks({
      id: 1,
      limit: 2,
      cursor,
    });

    expect(second.map((task) => task.id)).toEqual([103]);
  });

  it("is stable and repeatable: the same cursor yields the same page", async () => {
    const first = await rpc.client.projects.tasks({ id: 1, limit: 1 });
    const cursor = first[0].cursorFor;

    const second = await rpc.client.projects.tasks({
      id: 1,
      limit: 2,
      cursor,
    });
    const third = await rpc.client.projects.tasks({
      id: 1,
      limit: 2,
      cursor,
    });

    // spec/queries.md: the cursor "must be stable and repeatable".
    expect(second).toEqual(third);
    expect(second.map((task) => task.id)).toEqual([102, 103]);
  });

  it("keeps the status filter while paging", async () => {
    const first = await rpc.client.projects.tasks({
      id: 1,
      status: "todo",
      limit: 1,
    });

    expect(first.map((task) => task.id)).toEqual([102]);

    // The cursor must not silently reset the filter: the next page is the
    // NEXT TODO TASK, not the next task.
    const cursor = first[0].cursorFor;
    const second = await rpc.client.projects.tasks({
      id: 1,
      status: "todo",
      limit: 1,
      cursor,
    });

    expect(second).toEqual([]);
  });

  it("reads the first page for a cursor nothing could have produced", async () => {
    const tasks = await rpc.client.projects.tasks({ id: 1, cursor: "!!!!" });

    expect(tasks.map((task) => task.id)).toEqual([101, 102, 103]);
  });

  it("clamps the limit to [1, 26] like the reference", async () => {
    const zero = await rpc.client.projects.tasks({ id: 1, limit: 0 });

    expect(zero).toHaveLength(1);

    const huge = await rpc.client.projects.tasks({ id: 1, limit: 99 });

    // Three tasks in the project: the ceiling only shows once the fixture
    // outgrows it.
    expect(huge).toHaveLength(3);
  });
});

describe("projects.create", () => {
  it("creates the project and redirects to its board", async () => {
    const result = await rpc.client.projects.create({
      name: "Accessibility audit",
      description: "Audit every surface against WCAG AA.",
    });

    expect(result).toEqual({
      ok: true,
      message: "Project created.",
      redirectTo: "/projects/4",
    });

    // A persisted id must have been allocated: the redirect target resolves to
    // the committed row, with a fresh project's empty aggregates.
    const detail = await rpc.client.projects.byId({ id: 4 });

    expect(detail).toEqual({
      id: 4,
      name: "Accessibility audit",
      description: "Audit every surface against WCAG AA.",
      taskCount: 0,
      openTaskCount: 0,
      peopleCount: 0,
      createdAt: new Date().toISOString().slice(0, 10),
    });
  });

  it("reports the reference's field errors for an empty name", async () => {
    await expect(
      rpc.client.projects.create({ name: "", description: "d" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create project.",
        errors: { name: ["Project name is required."] },
      },
    });
  });

  it("requires a description, exactly as the reference's schema does", async () => {
    await expect(
      rpc.client.projects.create({ name: "No description" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create project.",
        errors: {
          description: ["Invalid input: expected string, received null"],
        },
      },
    });
  });
});

describe("projects.update", () => {
  it("updates the project and redirects to it", async () => {
    const result = await rpc.client.projects.update({
      id: 2,
      name: "Mobile application (v2)",
      description: "Ship the second mobile experience.",
    });

    expect(result).toEqual({
      ok: true,
      message: "Project updated.",
      redirectTo: "/projects/2",
    });

    const detail = await rpc.client.projects.byId({ id: 2 });

    expect(detail).toMatchObject({
      id: 2,
      name: "Mobile application (v2)",
      description: "Ship the second mobile experience.",
      // The aggregates survive an edit of the descriptive fields.
      taskCount: 2,
    });
  });

  it("reports the reference's field errors for a too-long name", async () => {
    await expect(
      rpc.client.projects.update({
        id: 2,
        name: "a".repeat(201),
        description: "d",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to update project.",
        errors: { name: ["Project name must be 200 characters or fewer."] },
      },
    });
  });

  it("returns the reference's 404 message for an unknown project", async () => {
    await expect(
      rpc.client.projects.update({
        id: 999,
        name: "No such",
        description: "d",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That project no longer exists." },
    });
  });
});

describe("projects.remove", () => {
  it("deletes an empty project and redirects to the listing", async () => {
    const created = await rpc.client.projects.create({
      name: "Short-lived project",
      description: "d",
    });
    const id = Number(created.redirectTo!.split("/")[2]);

    const result = await rpc.client.projects.remove({ id });

    expect(result).toEqual({
      ok: true,
      message: "Project deleted.",
      redirectTo: "/projects",
    });

    await expect(rpc.client.projects.byId({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "Not found" },
    });
  });

  it("refuses a project that still has tasks, with the reference's guard", async () => {
    await expect(rpc.client.projects.remove({ id: 3 })).rejects.toMatchObject({
      code: "CONFLICT",
      data: {
        error:
          "This project still has 1 task. Delete it before deleting the project.",
      },
    });

    await expect(rpc.client.projects.remove({ id: 1 })).rejects.toMatchObject({
      code: "CONFLICT",
      data: {
        error:
          "This project still has 3 tasks. Delete them before deleting the project.",
      },
    });

    // The refused delete changed nothing: the project still resolves.
    const detail = await rpc.client.projects.byId({ id: 1 });

    expect(detail.id).toBe(1);
  });

  it("returns the reference's 404 message for an unknown project", async () => {
    await expect(rpc.client.projects.remove({ id: 999 })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
        data: { error: "That project no longer exists." },
      },
    );
  });
});
