// tests/unit/projects.resolvers.test.ts
//
// The project resolvers' contract with the model stubbed: what they send to
// the model, what they resolve to, and which GraphQLError they throw for each
// refused outcome. No database, no supertest — the model is a fake, and the
// resolvers are called directly, exactly where the old controller tests drove
// the controller with a fake req/res.
//
// Deliberate failures are thrown as GraphQLErrors, and Yoga answers them with
// HTTP 200 and the error inside the response's `errors` array — so the shape
// that used to be asserted against the error handler's JSON envelope (the
// message string, the `code`, the field → messages map) is asserted here
// against the thrown error itself: `message` plus `extensions.code` /
// `extensions.errors` is the whole contract.
//
// The board's task-list arguments are validated by the tasks domain's pure
// validator (an unknown `status` is a BAD_INPUT error with the old message),
// because the board's rows are task rows — exactly as the REST controller
// reached across for it.

import { describe, expect, it, vi } from "vitest";

import { createProjectsResolvers } from "../../src/projects/projects.resolvers.ts";
import type { ProjectsModel } from "../../src/projects/projects.model.ts";

function makeModel(overrides: Partial<ProjectsModel> = {}): ProjectsModel {
  return {
    list: vi.fn(),
    get: vi.fn(),
    listTasks: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

const PROJECT = {
  id: 1,
  name: "Unit Project",
  description: "A project from the unit fixture.",
  taskCount: 0,
  openTaskCount: 0,
  peopleCount: 0,
  createdAt: "2026-09-27",
};

describe("ProjectsResolvers.Query.projects", () => {
  it("resolves with the model's rows", async () => {
    const model = makeModel({ list: vi.fn().mockResolvedValue([PROJECT]) });

    await expect(
      createProjectsResolvers(model).Query.projects(null, {}),
    ).resolves.toEqual([PROJECT]);
  });

  it("passes a trimmed q to the model", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await createProjectsResolvers(model).Query.projects(null, {
      q: "  redesign  ",
    });

    expect(list).toHaveBeenCalledWith("redesign");
  });

  it("throws BAD_INPUT for a q that is not a single value", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    // GraphQL types `q` as String, so a client cannot send an array — but the
    // resolver funnels whatever it receives through the shared validator,
    // whose single-value rule (the REST `?q=a&q=b` guard) stays the contract.
    await expect(
      createProjectsResolvers(model).Query.projects(null, {
        q: ["a", "b"] as unknown as string,
      }),
    ).rejects.toMatchObject({
      message: "q must be a single value",
      extensions: { code: "BAD_INPUT" },
    });

    // No query may run for arguments the resolver refused.
    expect(list).not.toHaveBeenCalled();
  });
});

describe("ProjectsResolvers.Query.project", () => {
  it("resolves with the model's row", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(PROJECT) });

    await expect(
      createProjectsResolvers(model).Query.project(null, { id: 1 }),
    ).resolves.toEqual(PROJECT);

    expect(model.get).toHaveBeenCalledWith(1);
  });

  it("throws NOT_FOUND when the row is missing", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(null) });

    await expect(
      createProjectsResolvers(model).Query.project(null, { id: 999 }),
    ).rejects.toMatchObject({
      message: "Not found",
      extensions: { code: "NOT_FOUND" },
    });
  });
});

describe("ProjectsResolvers.Query.projectTasks", () => {
  it("passes the project id and the parsed filters to the model", async () => {
    const task = {
      id: 101,
      projectId: 1,
      projectName: "Unit Project",
      title: "Unit task",
      description: "",
      status: "todo",
      assigneeName: "Unit Person",
      commentCount: 0,
      updatedAt: "2026-09-29T08:00:00Z",
      createdAtRaw: "2026-09-28T10:15:00.000000Z",
      cursorFor: "cursor",
    };
    const listTasks = vi.fn().mockResolvedValue([task]);
    const model = makeModel({ listTasks });

    await expect(
      createProjectsResolvers(model).Query.projectTasks(null, {
        projectId: 1,
        status: "todo",
        limit: 2,
      }),
    ).resolves.toEqual([task]);

    expect(listTasks).toHaveBeenCalledWith(1, {
      status: "todo",
      cursor: null,
      limit: 2,
    });
  });

  it("throws the reference's status message for an unknown status", async () => {
    const model = makeModel();

    await expect(
      createProjectsResolvers(model).Query.projectTasks(null, {
        projectId: 1,
        status: "bogus",
      }),
    ).rejects.toMatchObject({
      message: "Unknown task status: bogus",
      extensions: { code: "BAD_INPUT" },
    });

    expect(model.listTasks).not.toHaveBeenCalled();
  });
});

describe("ProjectsResolvers.Mutation.createProject", () => {
  it("resolves with the success envelope pointing at the new row", async () => {
    const model = makeModel({ create: vi.fn().mockResolvedValue({ id: 4 }) });

    await expect(
      createProjectsResolvers(model).Mutation.createProject(null, {
        name: "New project",
        description: "d",
      }),
    ).resolves.toEqual({
      ok: true,
      message: "Project created.",
      redirectTo: "/projects/4",
    });

    expect(model.create).toHaveBeenCalledWith({
      name: "New project",
      description: "d",
    });
  });

  it("throws the reference's field-error shape for an empty name", async () => {
    const model = makeModel();

    await expect(
      createProjectsResolvers(model).Mutation.createProject(null, {
        name: "",
        description: "d",
      }),
    ).rejects.toMatchObject({
      message: "Missing fields. Failed to create project.",
      extensions: {
        code: "BAD_INPUT",
        errors: { name: ["Project name is required."] },
      },
    });

    // Nothing may be written for a body the resolver refused.
    expect(model.create).not.toHaveBeenCalled();
  });
});

describe("ProjectsResolvers.Mutation.updateProject", () => {
  it("resolves with the success envelope pointing at the row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    await expect(
      createProjectsResolvers(model).Mutation.updateProject(null, {
        id: 1,
        name: "Renamed",
        description: "d",
      }),
    ).resolves.toEqual({
      ok: true,
      message: "Project updated.",
      redirectTo: "/projects/1",
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "missing" }),
    });

    await expect(
      createProjectsResolvers(model).Mutation.updateProject(null, {
        id: 999,
        name: "Renamed",
        description: "d",
      }),
    ).rejects.toMatchObject({
      message: "That project no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });
});

describe("ProjectsResolvers.Mutation.deleteProject", () => {
  it("resolves with the redirect to the projects listing", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    await expect(
      createProjectsResolvers(model).Mutation.deleteProject(null, { id: 3 }),
    ).resolves.toEqual({
      ok: true,
      message: "Project deleted.",
      redirectTo: "/projects",
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({ status: "missing" }),
    });

    await expect(
      createProjectsResolvers(model).Mutation.deleteProject(null, { id: 999 }),
    ).rejects.toMatchObject({
      message: "That project no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });

  it("throws the CONFLICT guard message while the project still has tasks", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({
        status: "restricted",
        message:
          "This project still has 1 task. Delete it before deleting the project.",
      }),
    });

    // The FK guard's actionable message travels in the GraphQLError's
    // message, with CONFLICT as the code the SPA's api client maps to 409.
    await expect(
      createProjectsResolvers(model).Mutation.deleteProject(null, { id: 1 }),
    ).rejects.toMatchObject({
      message:
        "This project still has 1 task. Delete it before deleting the project.",
      extensions: { code: "CONFLICT" },
    });
  });
});
