// tests/unit/projects.controller.test.ts
//
// The controller's HTTP contract with the model stubbed: what it sends to the
// model, what it writes to the reply, and which HttpError it throws for
// each refused outcome (the error handler maps the throw to its JSON
// envelope). No database, no inject — the model is a fake.

import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { createProjectsController } from "../../src/projects/projects.controller.ts";
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

function makeRequest(overrides: {
  query?: Record<string, unknown>;
  body?: unknown;
  params?: Record<string, string>;
} = {}): FastifyRequest {
  return {
    query: overrides.query ?? {},
    body: overrides.body,
    params: overrides.params ?? {},
  } as unknown as FastifyRequest;
}

function makeReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

type MockReply = ReturnType<typeof makeReply>;

function asFastifyReply(reply: MockReply): FastifyReply {
  return reply as unknown as FastifyReply;
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

describe("ProjectsController.list", () => {
  it("responds 200 with the model's rows as JSON", async () => {
    const model = makeModel({ list: vi.fn().mockResolvedValue([PROJECT]) });
    const reply = makeReply();

    await createProjectsController(model).list(
      makeRequest(),
      asFastifyReply(reply),
    );

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith([PROJECT]);
  });

  it("passes a trimmed q to the model", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await createProjectsController(model).list(
      makeRequest({ query: { q: "  redesign  " } }),
      asFastifyReply(makeReply()),
    );

    expect(list).toHaveBeenCalledWith("redesign");
  });

  it("throws the 400 HttpError envelope when q is an array", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });
    const reply = makeReply();

    await expect(
      createProjectsController(model).list(
        makeRequest({ query: { q: ["a", "b"] } }),
        asFastifyReply(reply),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: { error: "q must be a single value" },
    });

    expect(list).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});

describe("ProjectsController.get", () => {
  it("responds 200 with the model's row", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(PROJECT) });
    const reply = makeReply();

    await createProjectsController(model).get(
      makeRequest({ params: { id: "1" } }),
      asFastifyReply(reply),
    );

    expect(model.get).toHaveBeenCalledWith(1);
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(PROJECT);
  });

  it("throws the plain 404 envelope when the row is missing", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(null) });

    await expect(
      createProjectsController(model).get(
        makeRequest({ params: { id: "999" } }),
        asFastifyReply(makeReply()),
      ),
    ).rejects.toMatchObject({
      status: 404,
      payload: { error: "Not found" },
    });
  });
});

describe("ProjectsController.listTasks", () => {
  it("passes the route id and the parsed filters to the model", async () => {
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
    const reply = makeReply();

    await createProjectsController(model).listTasks(
      makeRequest({ params: { id: "1" }, query: { status: "todo", limit: "2" } }),
      asFastifyReply(reply),
    );

    expect(listTasks).toHaveBeenCalledWith(1, { status: "todo", cursor: null, limit: 2 });
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith([task]);
  });

  it("throws the reference's status message for an unknown status", async () => {
    const model = makeModel();

    await expect(
      createProjectsController(model).listTasks(
        makeRequest({ params: { id: "1" }, query: { status: "bogus" } }),
        asFastifyReply(makeReply()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: { error: "Unknown task status: bogus" },
    });

    expect(model.listTasks).not.toHaveBeenCalled();
  });
});

describe("ProjectsController.create", () => {
  it("responds 201 with the success envelope pointing at the new row", async () => {
    const model = makeModel({ create: vi.fn().mockResolvedValue({ id: 4 }) });
    const reply = makeReply();

    await createProjectsController(model).create(
      makeRequest({ body: { name: "New project", description: "d" } }),
      asFastifyReply(reply),
    );

    expect(model.create).toHaveBeenCalledWith({
      name: "New project",
      description: "d",
    });
    expect(reply.status).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith({
      ok: true,
      message: "Project created.",
      redirectTo: "/projects/4",
    });
  });

  it("throws the reference's field-error envelope for an empty name", async () => {
    const model = makeModel();

    await expect(
      createProjectsController(model).create(
        makeRequest({ body: { name: "", description: "d" } }),
        asFastifyReply(makeReply()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: {
        error: "Missing fields. Failed to create project.",
        errors: { name: ["Project name is required."] },
      },
    });

    expect(model.create).not.toHaveBeenCalled();
  });
});

describe("ProjectsController.update", () => {
  it("responds 200 with the success envelope pointing at the row", async () => {
    const model = makeModel({ update: vi.fn().mockResolvedValue({ status: "ok" }) });
    const reply = makeReply();

    await createProjectsController(model).update(
      makeRequest({
        params: { id: "1" },
        body: { name: "Renamed", description: "d" },
      }),
      asFastifyReply(reply),
    );

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      ok: true,
      message: "Project updated.",
      redirectTo: "/projects/1",
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({ update: vi.fn().mockResolvedValue({ status: "missing" }) });

    await expect(
      createProjectsController(model).update(
        makeRequest({
          params: { id: "999" },
          body: { name: "Renamed", description: "d" },
        }),
        asFastifyReply(makeReply()),
      ),
    ).rejects.toMatchObject({
      status: 404,
      payload: { error: "That project no longer exists." },
    });
  });
});

describe("ProjectsController.remove", () => {
  it("responds 200 with the redirect to the projects listing", async () => {
    const model = makeModel({ remove: vi.fn().mockResolvedValue({ status: "ok" }) });
    const reply = makeReply();

    await createProjectsController(model).remove(
      makeRequest({ params: { id: "3" } }),
      asFastifyReply(reply),
    );

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      ok: true,
      message: "Project deleted.",
      redirectTo: "/projects",
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({ remove: vi.fn().mockResolvedValue({ status: "missing" }) });

    await expect(
      createProjectsController(model).remove(
        makeRequest({ params: { id: "999" } }),
        asFastifyReply(makeReply()),
      ),
    ).rejects.toMatchObject({
      status: 404,
      payload: { error: "That project no longer exists." },
    });
  });

  it("throws the 409 guard message while the project still has tasks", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({
        status: "restricted",
        message:
          "This project still has 1 task. Delete it before deleting the project.",
      }),
    });

    await expect(
      createProjectsController(model).remove(
        makeRequest({ params: { id: "1" } }),
        asFastifyReply(makeReply()),
      ),
    ).rejects.toMatchObject({
      status: 409,
      payload: {
        error:
          "This project still has 1 task. Delete it before deleting the project.",
      },
    });
  });
});
