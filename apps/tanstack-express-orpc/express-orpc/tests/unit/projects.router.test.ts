// tests/unit/projects.router.test.ts
//
// The projects router's contract with the model stubbed: what it sends to the
// model, what it resolves to, and which ORPCError it throws for each refused
// outcome. No database, no HTTP — the procedure is driven in process through
// `call`, which is the same entry the RPC handler uses, minus the transport.
//
// This replaces the REST variant's projects.controller.test.ts: the router is
// the controller now, and the outcomes the controller wrote to the response
// (status codes + JSON envelopes) are carried by the ORPCError codes and the
// error envelope in its `data` (src/orpc/errors.ts owns the mapping).

import { call, ORPCError } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";

import type { ProjectsModel } from "../../src/projects/projects.model.ts";
import { createProjectsRouter } from "../../src/orpc/routers/projects.ts";

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

describe("projects.list", () => {
  it("resolves with the model's rows", async () => {
    const model = makeModel({ list: vi.fn().mockResolvedValue([PROJECT]) });

    const projects = await call(createProjectsRouter(model).list, {});

    expect(projects).toEqual([PROJECT]);
  });

  it("passes a trimmed q to the model", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await call(createProjectsRouter(model).list, { q: "  redesign  " });

    expect(list).toHaveBeenCalledWith("redesign");
  });

  it("throws the 400 envelope when q exceeds 100 characters", async () => {
    const model = makeModel();

    await expect(
      call(createProjectsRouter(model).list, { q: "a".repeat(101) }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { error: "q must be at most 100 characters" },
    });
  });
});

describe("projects.byId", () => {
  it("resolves with the model's row", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(PROJECT) });

    const project = await call(createProjectsRouter(model).byId, { id: 1 });

    expect(model.get).toHaveBeenCalledWith(1);
    expect(project).toEqual(PROJECT);
  });

  it("throws the NOT_FOUND envelope when the row is missing", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(null) });

    await expect(call(createProjectsRouter(model).byId, { id: 999 })).rejects
      .toMatchObject({
        code: "NOT_FOUND",
        data: { error: "Not found" },
      });
  });
});

describe("projects.tasks", () => {
  it("passes the id and the parsed filters to the model", async () => {
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

    const rows = await call(createProjectsRouter(model).tasks, {
      id: 1,
      status: " todo ",
      limit: 2,
    });

    expect(listTasks).toHaveBeenCalledWith(1, {
      status: "todo",
      cursor: null,
      limit: 2,
    });
    expect(rows).toEqual([task]);
  });

  it("throws the reference's status message for an unknown status", async () => {
    const model = makeModel();

    await expect(
      call(createProjectsRouter(model).tasks, { id: 1, status: "bogus" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { error: "Unknown task status: bogus" },
    });

    expect(model.listTasks).not.toHaveBeenCalled();
  });
});

describe("projects.create", () => {
  it("resolves with the success envelope pointing at the new row", async () => {
    const model = makeModel({ create: vi.fn().mockResolvedValue({ id: 4 }) });

    const result = await call(createProjectsRouter(model).create, {
      name: "New project",
      description: "d",
    });

    expect(model.create).toHaveBeenCalledWith({
      name: "New project",
      description: "d",
    });
    expect(result).toEqual({
      ok: true,
      message: "Project created.",
      redirectTo: "/projects/4",
    });
  });

  it("throws the reference's field-error envelope for an empty name", async () => {
    const model = makeModel();

    await expect(
      call(createProjectsRouter(model).create, {
        name: "",
        description: "d",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create project.",
        errors: { name: ["Project name is required."] },
      },
    });

    expect(model.create).not.toHaveBeenCalled();
  });
});

describe("projects.update", () => {
  it("resolves with the success envelope pointing at the row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    const result = await call(createProjectsRouter(model).update, {
      id: 1,
      name: "Renamed",
      description: "d",
    });

    expect(result).toEqual({
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
      call(createProjectsRouter(model).update, {
        id: 999,
        name: "Renamed",
        description: "d",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That project no longer exists." },
    });
  });
});

describe("projects.remove", () => {
  it("resolves with the redirect to the projects listing", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    const result = await call(createProjectsRouter(model).remove, { id: 3 });

    expect(result).toEqual({
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
      call(createProjectsRouter(model).remove, { id: 999 }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That project no longer exists." },
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

    const error = await call(createProjectsRouter(model).remove, { id: 1 }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      data: {
        error:
          "This project still has 1 task. Delete it before deleting the project.",
      },
    });
  });
});
