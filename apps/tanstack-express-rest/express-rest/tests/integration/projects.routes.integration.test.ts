// tests/integration/projects.routes.integration.test.ts
//
// The /api/projects surface — the reads behind the project listing and board
// pages, and the writes behind the project forms. Exercises the full HTTP
// stack (routes → controller → model → Postgres) through supertest against
// the seeded test database, and asserts the exact rows the shared fixture
// produces so a SQL drift is caught here, not in the browser.
//
// The row shapes and orderings mirror the reference variant (getProjects,
// getProject, getProjectTasks), including the board's keyset paging over
// `(created_at, id)`.

import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/app.ts";
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

describe("GET /api/projects", () => {
  it("returns 200 with a JSON array", async () => {
    const response = await request(createApp()).get("/api/projects");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it("returns exactly the seeded projects and aggregate columns", async () => {
    const response = await request(createApp()).get("/api/projects");

    // toEqual (not toMatchObject): the row shape is the API contract — an
    // extra or missing key is a breaking change for the client that renders it.
    expect(response.body).toEqual(EXPECTED_PROJECTS);
  });

  it("orders projects by created_at descending, then id descending", async () => {
    const response = await request(createApp()).get("/api/projects");

    expect(response.body.map((project: { id: number }) => project.id)).toEqual([
      1, 2, 3,
    ]);
  });

  it("matches a project name case-insensitively", async () => {
    const response = await request(createApp()).get("/api/projects?q=REDESIGN");

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: 1,
      name: "Website redesign",
    });
  });

  it("matches on description as well as name", async () => {
    // "platform" appears in project 3's description and its name; "onboarding"
    // only in project 1's description.
    const platform = await request(createApp()).get("/api/projects?q=platform");
    const onboarding = await request(createApp()).get(
      "/api/projects?q=onboarding",
    );

    expect(platform.body.map((p: { id: number }) => p.id)).toEqual([3]);
    expect(onboarding.body.map((p: { id: number }) => p.id)).toEqual([1]);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    const percent = await request(createApp()).get("/api/projects?q=%");
    const underscore = await request(createApp()).get("/api/projects?q=_");

    expect(percent.body).toEqual([]);
    expect(underscore.body).toEqual([]);
  });

  it("returns 400 when q is repeated", async () => {
    const response = await request(createApp()).get(
      "/api/projects?q=redesign&q=migration",
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "q must be a single value" });
  });
});

describe("GET /api/projects/:id", () => {
  it("returns exactly the project row", async () => {
    const response = await request(createApp()).get("/api/projects/2");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(EXPECTED_PROJECTS[1]);
  });

  it("returns the plain 404 envelope for an unknown id", async () => {
    const response = await request(createApp()).get("/api/projects/999");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
  });

  it("returns 400 for an id that cannot name a row", async () => {
    const response = await request(createApp()).get("/api/projects/abc");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "id must be a positive integer" });
  });
});

describe("GET /api/projects/:id/tasks", () => {
  it("returns the board's rows with their cursor fields", async () => {
    const response = await request(createApp()).get("/api/projects/1/tasks");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(PROJECT_1_TASKS);
  });

  it("orders the board by created_at descending, then id descending", async () => {
    const response = await request(createApp()).get("/api/projects/1/tasks");

    expect(response.body.map((task: { id: number }) => task.id)).toEqual([
      101, 102, 103,
    ]);
  });

  it("returns an empty board for an unknown project", async () => {
    // Mirror getProjectTasks: the board of a project that has no tasks — or
    // that no longer exists — is empty, not an error.
    const response = await request(createApp()).get("/api/projects/999/tasks");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("filters the board by status", async () => {
    const todo = await request(createApp()).get(
      "/api/projects/1/tasks?status=todo",
    );
    const done = await request(createApp()).get(
      "/api/projects/1/tasks?status=done",
    );

    expect(todo.body.map((task: { id: number }) => task.id)).toEqual([102]);
    expect(done.body.map((task: { id: number }) => task.id)).toEqual([103]);
  });

  it("returns 400 with the reference's message for an unknown status", async () => {
    const response = await request(createApp()).get(
      "/api/projects/1/tasks?status=shipped",
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Unknown task status: shipped" });
  });

  it("pages the board by keyset over (created_at, id)", async () => {
    const first = await request(createApp()).get(
      "/api/projects/1/tasks?limit=2",
    );

    expect(first.body.map((task: { id: number }) => task.id)).toEqual([
      101, 102,
    ]);

    // The last row's cursorFor is the (created_at, id) tuple the next page
    // starts after.
    const cursor = first.body[1].cursorFor;
    const second = await request(createApp()).get(
      `/api/projects/1/tasks?limit=2&cursor=${encodeURIComponent(cursor)}`,
    );

    expect(second.body.map((task: { id: number }) => task.id)).toEqual([103]);
  });

  it("is stable and repeatable: the same cursor yields the same page", async () => {
    const first = await request(createApp()).get(
      "/api/projects/1/tasks?limit=1",
    );
    const cursor = first.body[0].cursorFor;
    const url = `/api/projects/1/tasks?limit=2&cursor=${encodeURIComponent(cursor)}`;

    const second = await request(createApp()).get(url);
    const third = await request(createApp()).get(url);

    // spec/queries.md: the cursor "must be stable and repeatable".
    expect(second.body).toEqual(third.body);
    expect(second.body.map((task: { id: number }) => task.id)).toEqual([
      102, 103,
    ]);
  });

  it("keeps the status filter while paging", async () => {
    const first = await request(createApp()).get(
      "/api/projects/1/tasks?status=todo&limit=1",
    );

    expect(first.body.map((task: { id: number }) => task.id)).toEqual([102]);

    // The cursor must not silently reset the filter: the next page is the
    // NEXT TODO TASK, not the next task.
    const cursor = first.body[0].cursorFor;
    const second = await request(createApp()).get(
      `/api/projects/1/tasks?status=todo&limit=1&cursor=${encodeURIComponent(cursor)}`,
    );

    expect(second.body).toEqual([]);
  });

  it("reads the first page for a cursor nothing could have produced", async () => {
    const response = await request(createApp()).get(
      "/api/projects/1/tasks?cursor=!!!!",
    );

    expect(response.status).toBe(200);
    expect(response.body.map((task: { id: number }) => task.id)).toEqual([
      101, 102, 103,
    ]);
  });

  it("clamps the limit to [1, 26] like the reference", async () => {
    const zero = await request(createApp()).get(
      "/api/projects/1/tasks?limit=0",
    );

    expect(zero.body).toHaveLength(1);

    const huge = await request(createApp()).get(
      "/api/projects/1/tasks?limit=99",
    );

    // Three tasks in the project: the ceiling only shows once the fixture
    // outgrows it.
    expect(huge.body).toHaveLength(3);
  });

  it("returns 400 for a non-integer limit", async () => {
    const response = await request(createApp()).get(
      "/api/projects/1/tasks?limit=many",
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "limit must be an integer" });
  });
});

describe("POST /api/projects", () => {
  it("creates the project and redirects to its board", async () => {
    const response = await request(createApp()).post("/api/projects").send({
      name: "Accessibility audit",
      description: "Audit every surface against WCAG AA.",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      ok: true,
      message: "Project created.",
      redirectTo: "/projects/4",
    });

    // A persisted id must have been allocated: the redirect target resolves to
    // the committed row, with a fresh project's empty aggregates.
    const detail = await request(createApp()).get("/api/projects/4");

    expect(detail.status).toBe(200);
    expect(detail.body).toEqual({
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
    const response = await request(createApp())
      .post("/api/projects")
      .send({ name: "", description: "d" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to create project.",
      errors: { name: ["Project name is required."] },
    });
  });

  it("requires a description, exactly as the reference's schema does", async () => {
    const response = await request(createApp())
      .post("/api/projects")
      .send({ name: "No description" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to create project.",
      errors: {
        description: ["Invalid input: expected string, received null"],
      },
    });
  });
});

describe("PATCH /api/projects/:id", () => {
  it("updates the project and redirects to it", async () => {
    const response = await request(createApp()).patch("/api/projects/2").send({
      name: "Mobile application (v2)",
      description: "Ship the second mobile experience.",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      message: "Project updated.",
      redirectTo: "/projects/2",
    });

    const detail = await request(createApp()).get("/api/projects/2");

    expect(detail.body).toMatchObject({
      id: 2,
      name: "Mobile application (v2)",
      description: "Ship the second mobile experience.",
      // The aggregates survive an edit of the descriptive fields.
      taskCount: 2,
    });
  });

  it("reports the reference's field errors for a too-long name", async () => {
    const response = await request(createApp())
      .patch("/api/projects/2")
      .send({ name: "a".repeat(201), description: "d" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to update project.",
      errors: { name: ["Project name must be 200 characters or fewer."] },
    });
  });

  it("returns the reference's 404 message for an unknown project", async () => {
    const response = await request(createApp())
      .patch("/api/projects/999")
      .send({ name: "No such", description: "d" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "That project no longer exists." });
  });
});

describe("DELETE /api/projects/:id", () => {
  it("deletes an empty project and redirects to the listing", async () => {
    const created = await request(createApp()).post("/api/projects").send({
      name: "Short-lived project",
      description: "d",
    });
    const id = created.body.redirectTo.split("/")[2];

    const response = await request(createApp()).delete(`/api/projects/${id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      message: "Project deleted.",
      redirectTo: "/projects",
    });

    const detail = await request(createApp()).get(`/api/projects/${id}`);

    expect(detail.status).toBe(404);
    expect(detail.body).toEqual({ error: "Not found" });
  });

  it("refuses a project that still has tasks, with the reference's guard", async () => {
    const singular = await request(createApp()).delete("/api/projects/3");

    expect(singular.status).toBe(409);
    expect(singular.body).toEqual({
      error:
        "This project still has 1 task. Delete it before deleting the project.",
    });

    const plural = await request(createApp()).delete("/api/projects/1");

    expect(plural.status).toBe(409);
    expect(plural.body).toEqual({
      error:
        "This project still has 3 tasks. Delete them before deleting the project.",
    });

    // The refused delete changed nothing.
    const detail = await request(createApp()).get("/api/projects/1");

    expect(detail.status).toBe(200);
  });

  it("returns the reference's 404 message for an unknown project", async () => {
    const response = await request(createApp()).delete("/api/projects/999");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "That project no longer exists." });
  });
});
