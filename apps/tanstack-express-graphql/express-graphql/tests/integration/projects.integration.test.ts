// tests/integration/projects.integration.test.ts
//
// The projects surface — the reads behind the project listing and board pages,
// and the writes behind the project forms. Exercises the full stack
// (POST /graphql → resolvers → models → Postgres) through supertest against
// the seeded test database, and asserts the exact rows the shared fixture
// produces so a SQL drift is caught here, not in the browser.
//
// The row shapes and orderings mirror the reference variant (getProjects,
// getProject, getProjectTasks), including the board's keyset paging over
// `(created_at, id)`.
//
// Every argument travels as a variable, every refusal is HTTP 200 with the
// error inside `errors` — the old 400 `{ error }` envelopes are now
// `errors[0].message` with `extensions.code: "BAD_INPUT"`, the old 404/409
// outcomes carry NOT_FOUND/CONFLICT.

import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "../../src/app.ts";
import { encodeCursor } from "../../src/lib/cursor.ts";

function gql(
  app: Express,
  query: string,
  variables: Record<string, unknown> = {},
) {
  return request(app).post("/graphql").send({ query, variables });
}

const PROJECTS_QUERY = `
  query Projects($q: String) {
    projects(q: $q) {
      id
      name
      description
      taskCount
      openTaskCount
      peopleCount
      createdAt
    }
  }
`;

const PROJECT_QUERY = `
  query Project($id: Int!) {
    project(id: $id) {
      id
      name
      description
      taskCount
      openTaskCount
      peopleCount
      createdAt
    }
  }
`;

// The board pages over (created_at, id) rather than (updated_at, id), so its
// rows carry createdAtRaw/cursorFor instead of the list's updatedAtRaw.
const PROJECT_TASKS_QUERY = `
  query ProjectTasks($projectId: Int!, $status: String, $cursor: String, $limit: Int) {
    projectTasks(
      projectId: $projectId
      status: $status
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
      createdAtRaw
      cursorFor
    }
  }
`;

const CREATE_PROJECT_MUTATION = `
  mutation CreateProject($name: String, $description: String) {
    createProject(name: $name, description: $description) {
      ok
      message
      redirectTo
    }
  }
`;

const UPDATE_PROJECT_MUTATION = `
  mutation UpdateProject($id: Int!, $name: String, $description: String) {
    updateProject(id: $id, name: $name, description: $description) {
      ok
      message
      redirectTo
    }
  }
`;

const DELETE_PROJECT_MUTATION = `
  mutation DeleteProject($id: Int!) {
    deleteProject(id: $id) {
      ok
      message
      redirectTo
    }
  }
`;

// The seeded fixture (spec/snapshots/correctness), worked through by hand:
//
//   projects 1 Website redesign (created 09-27), 2 Mobile application (09-21),
//            3 Platform migration (09-12)
//   tasks     101, 102, 103 → project 1; 104, 105 → project 2; 106 → project 3
//
// Expected rows, in created_at DESC, id DESC order (the projects contract):
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

// Project 1's board, in created_at DESC, id DESC order (the projectTasks
// contract):
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

describe("query projects", () => {
  it("returns 200 with a JSON body and an array under data", async () => {
    const response = await gql(createApp(), PROJECTS_QUERY);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(Array.isArray(response.body.data.projects)).toBe(true);
  });

  it("returns exactly the seeded projects and aggregate columns", async () => {
    const response = await gql(createApp(), PROJECTS_QUERY);

    // toEqual (not toMatchObject): the row shape is the API contract — an
    // extra or missing key is a breaking change for the client that renders it.
    expect(response.body.data.projects).toEqual(EXPECTED_PROJECTS);
  });

  it("orders projects by created_at descending, then id descending", async () => {
    const response = await gql(createApp(), PROJECTS_QUERY);

    expect(
      response.body.data.projects.map((project: { id: number }) => project.id),
    ).toEqual([1, 2, 3]);
  });

  it("matches a project name case-insensitively", async () => {
    const response = await gql(createApp(), PROJECTS_QUERY, {
      q: "REDESIGN",
    });

    expect(response.body.data.projects).toHaveLength(1);
    expect(response.body.data.projects[0]).toMatchObject({
      id: 1,
      name: "Website redesign",
    });
  });

  it("matches on description as well as name", async () => {
    // "platform" appears in project 3's description and its name; "onboarding"
    // only in project 1's description.
    const platform = await gql(createApp(), PROJECTS_QUERY, { q: "platform" });
    const onboarding = await gql(createApp(), PROJECTS_QUERY, {
      q: "onboarding",
    });

    expect(
      platform.body.data.projects.map((p: { id: number }) => p.id),
    ).toEqual([3]);
    expect(
      onboarding.body.data.projects.map((p: { id: number }) => p.id),
    ).toEqual([1]);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    // A bare `%` would otherwise match every row and hide a real escaping bug.
    const percent = await gql(createApp(), PROJECTS_QUERY, { q: "%" });
    const underscore = await gql(createApp(), PROJECTS_QUERY, { q: "_" });

    expect(percent.body.data.projects).toEqual([]);
    expect(underscore.body.data.projects).toEqual([]);
  });
});

describe("query project", () => {
  it("returns exactly the project row", async () => {
    const response = await gql(createApp(), PROJECT_QUERY, { id: 2 });

    expect(response.status).toBe(200);
    expect(response.body.data.project).toEqual(EXPECTED_PROJECTS[1]);
  });

  it("answers NOT_FOUND for an unknown id", async () => {
    const response = await gql(createApp(), PROJECT_QUERY, { id: 999 });

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
    // The REST guard rejected "/api/projects/abc" with this message; GraphQL's
    // Int! argument reaches the same guard with a non-positive integer.
    const response = await gql(createApp(), PROJECT_QUERY, { id: 0 });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "id must be a positive integer",
      extensions: { code: "BAD_INPUT" },
    });
  });
});

describe("query projectTasks", () => {
  it("returns the board's rows with their cursor fields", async () => {
    const response = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.projectTasks).toEqual(PROJECT_1_TASKS);
  });

  it("orders the board by created_at descending, then id descending", async () => {
    const response = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
    });

    expect(
      response.body.data.projectTasks.map((task: { id: number }) => task.id),
    ).toEqual([101, 102, 103]);
  });

  it("returns an empty board for an unknown project", async () => {
    // Mirror the reference's getProjectTasks: the board of a project that has
    // no tasks — or that no longer exists — is empty, not an error.
    const response = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 999,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.projectTasks).toEqual([]);
  });

  it("filters the board by status", async () => {
    const todo = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      status: "todo",
    });
    const done = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      status: "done",
    });

    expect(
      todo.body.data.projectTasks.map((task: { id: number }) => task.id),
    ).toEqual([102]);
    expect(
      done.body.data.projectTasks.map((task: { id: number }) => task.id),
    ).toEqual([103]);
  });

  it("answers BAD_INPUT with the reference's message for an unknown status", async () => {
    const response = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      status: "shipped",
    });

    // The old 400 `{ error: "Unknown task status: shipped" }`: HTTP is 200,
    // the data is gone, and the error carries the same message under
    // BAD_INPUT.
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Unknown task status: shipped",
      extensions: { code: "BAD_INPUT" },
    });
  });

  it("pages the board by keyset over (created_at, id)", async () => {
    const first = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      limit: 2,
    });

    expect(
      first.body.data.projectTasks.map((task: { id: number }) => task.id),
    ).toEqual([101, 102]);

    // The last row's cursorFor is the (created_at, id) tuple the next page
    // starts after.
    const cursor = first.body.data.projectTasks[1].cursorFor;
    const second = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      limit: 2,
      cursor,
    });

    expect(
      second.body.data.projectTasks.map((task: { id: number }) => task.id),
    ).toEqual([103]);
  });

  it("is stable and repeatable: the same cursor yields the same page", async () => {
    const first = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      limit: 1,
    });
    const cursor = first.body.data.projectTasks[0].cursorFor;

    // spec/queries.md: the cursor "must be stable and repeatable".
    const second = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      limit: 2,
      cursor,
    });
    const third = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      limit: 2,
      cursor,
    });

    expect(second.body.data).toEqual(third.body.data);
    expect(
      second.body.data.projectTasks.map((task: { id: number }) => task.id),
    ).toEqual([102, 103]);
  });

  it("keeps the status filter while paging", async () => {
    const first = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      status: "todo",
      limit: 1,
    });

    expect(
      first.body.data.projectTasks.map((task: { id: number }) => task.id),
    ).toEqual([102]);

    // The cursor must not silently reset the filter: the next page is the
    // NEXT TODO TASK, not the next task.
    const cursor = first.body.data.projectTasks[0].cursorFor;
    const second = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      status: "todo",
      limit: 1,
      cursor,
    });

    expect(second.body.data.projectTasks).toEqual([]);
  });

  it("reads the first page for a cursor nothing could have produced", async () => {
    const response = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      cursor: "!!!!",
    });

    expect(response.status).toBe(200);
    expect(
      response.body.data.projectTasks.map((task: { id: number }) => task.id),
    ).toEqual([101, 102, 103]);
  });

  it("clamps the limit to [1, 26] like the reference", async () => {
    const zero = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      limit: 0,
    });

    expect(zero.body.data.projectTasks).toHaveLength(1);

    const huge = await gql(createApp(), PROJECT_TASKS_QUERY, {
      projectId: 1,
      limit: 99,
    });

    // Three tasks in the project: the ceiling only shows once the fixture
    // outgrows it.
    expect(huge.body.data.projectTasks).toHaveLength(3);
  });
});

describe("mutation createProject", () => {
  it("creates the project and points the client at its board", async () => {
    const response = await gql(createApp(), CREATE_PROJECT_MUTATION, {
      name: "Accessibility audit",
      description: "Audit every surface against WCAG AA.",
    });

    // The old 201 + JSON envelope is now a 200 whose data IS the envelope.
    expect(response.status).toBe(200);
    expect(response.body.data.createProject).toEqual({
      ok: true,
      message: "Project created.",
      redirectTo: "/projects/4",
    });

    // A persisted id must have been allocated: the redirect target resolves to
    // the committed row, with a fresh project's empty aggregates.
    const detail = await gql(createApp(), PROJECT_QUERY, { id: 4 });

    expect(detail.status).toBe(200);
    expect(detail.body.data.project).toEqual({
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
    const response = await gql(createApp(), CREATE_PROJECT_MUTATION, {
      name: "",
      description: "d",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create project.",
      extensions: {
        code: "BAD_INPUT",
        errors: { name: ["Project name is required."] },
      },
    });
  });

  it("requires a description, exactly as the reference's schema does", async () => {
    // The description variable is simply not sent — the form field was absent.
    const response = await gql(createApp(), CREATE_PROJECT_MUTATION, {
      name: "No description",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create project.",
      extensions: {
        code: "BAD_INPUT",
        errors: {
          description: ["Invalid input: expected string, received null"],
        },
      },
    });
  });
});

describe("mutation updateProject", () => {
  it("updates the project and points the client back at it", async () => {
    const response = await gql(createApp(), UPDATE_PROJECT_MUTATION, {
      id: 2,
      name: "Mobile application (v2)",
      description: "Ship the second mobile experience.",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.updateProject).toEqual({
      ok: true,
      message: "Project updated.",
      redirectTo: "/projects/2",
    });

    const detail = await gql(createApp(), PROJECT_QUERY, { id: 2 });

    expect(detail.body.data.project).toMatchObject({
      id: 2,
      name: "Mobile application (v2)",
      description: "Ship the second mobile experience.",
      // The aggregates survive an edit of the descriptive fields.
      taskCount: 2,
    });
  });

  it("reports the reference's field errors for a too-long name", async () => {
    const response = await gql(createApp(), UPDATE_PROJECT_MUTATION, {
      id: 2,
      name: "a".repeat(201),
      description: "d",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to update project.",
      extensions: {
        code: "BAD_INPUT",
        errors: { name: ["Project name must be 200 characters or fewer."] },
      },
    });
  });

  it("answers NOT_FOUND with the reference's message for an unknown project", async () => {
    const response = await gql(createApp(), UPDATE_PROJECT_MUTATION, {
      id: 999,
      name: "No such",
      description: "d",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "That project no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });
});

describe("mutation deleteProject", () => {
  it("deletes an empty project and points the client at the listing", async () => {
    const created = await gql(createApp(), CREATE_PROJECT_MUTATION, {
      name: "Short-lived project",
      description: "d",
    });
    const id = created.body.data.createProject.redirectTo.split("/")[2];

    const response = await gql(createApp(), DELETE_PROJECT_MUTATION, {
      id: Number(id),
    });

    expect(response.status).toBe(200);
    expect(response.body.data.deleteProject).toEqual({
      ok: true,
      message: "Project deleted.",
      redirectTo: "/projects",
    });

    const detail = await gql(createApp(), PROJECT_QUERY, { id: Number(id) });

    expect(detail.body.data).toBeNull();
    expect(detail.body.errors[0]).toMatchObject({
      message: "Not found",
      extensions: { code: "NOT_FOUND" },
    });
  });

  it("refuses a project that still has tasks, with the reference's guard", async () => {
    // The old 409 guard outcomes: the actionable message in `errors`, CONFLICT
    // as the code the SPA's api client maps back to 409.
    const singular = await gql(createApp(), DELETE_PROJECT_MUTATION, {
      id: 3,
    });

    expect(singular.body.data).toBeNull();
    expect(singular.body.errors[0]).toMatchObject({
      message:
        "This project still has 1 task. Delete it before deleting the project.",
      extensions: { code: "CONFLICT" },
    });

    const plural = await gql(createApp(), DELETE_PROJECT_MUTATION, {
      id: 1,
    });

    expect(plural.body.data).toBeNull();
    expect(plural.body.errors[0]).toMatchObject({
      message:
        "This project still has 3 tasks. Delete them before deleting the project.",
      extensions: { code: "CONFLICT" },
    });

    // The refused delete changed nothing.
    const detail = await gql(createApp(), PROJECT_QUERY, { id: 1 });

    expect(detail.status).toBe(200);
    expect(detail.body.data.project).toMatchObject({ id: 1 });
  });

  it("answers NOT_FOUND with the reference's message for an unknown project", async () => {
    const response = await gql(createApp(), DELETE_PROJECT_MUTATION, {
      id: 999,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "That project no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });
});
