// tests/unit/tasks.controller.test.ts
//
// The controller's HTTP contract with the model stubbed: what it sends to the
// model, what it writes to the response, and which HttpError it throws for
// each refused outcome (the error handler maps the throw to the same JSON
// envelope the old direct writes produced). No database, no supertest — the
// model is a fake.

import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { createTasksController } from "../../src/tasks/tasks.controller.ts";
import type { TasksModel } from "../../src/tasks/tasks.model.ts";

function makeModel(overrides: Partial<TasksModel> = {}): TasksModel {
  return {
    list: vi.fn(),
    count: vi.fn(),
    get: vi.fn(),
    listByProject: vi.fn(),
    listByAssignee: vi.fn(),
    listComments: vi.fn(),
    resolveRefs: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    createWithComment: vi.fn(),
    addComment: vi.fn(),
    ...overrides,
  };
}

function makeRequest(
  overrides: {
    query?: Record<string, unknown>;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Request {
  return {
    query: overrides.query ?? {},
    body: overrides.body,
    params: overrides.params ?? {},
  } as unknown as Request;
}

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

type MockResponse = ReturnType<typeof makeResponse>;

function asExpressResponse(res: MockResponse): Response {
  return res as unknown as Response;
}

const TASK = {
  id: 101,
  projectId: 1,
  projectName: "Unit Project",
  title: "Unit task",
  description: "A task from the unit fixture.",
  status: "todo",
  assigneeName: "Unit Person",
  commentCount: 0,
  updatedAt: "2026-09-29T08:00:00Z",
};

describe("TasksController.list", () => {
  it("responds 200 with the model's rows as JSON", async () => {
    const model = makeModel({ list: vi.fn().mockResolvedValue([TASK]) });
    const res = makeResponse();

    await createTasksController(model).list(
      makeRequest(),
      asExpressResponse(res),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([TASK]);
  });

  it("passes the parsed filters to the model", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await createTasksController(model).list(
      makeRequest({ query: { q: "  navigation  ", status: " todo " } }),
      asExpressResponse(makeResponse()),
    );

    expect(list).toHaveBeenCalledWith({
      search: "navigation",
      status: "todo",
      cursor: null,
    });
  });

  it("rejects when the model rejects, so Express forwards to the error handler", async () => {
    const model = makeModel({
      list: vi.fn().mockRejectedValue(new Error("db down")),
    });

    // Express 5 treats a rejected async handler as next(err); the controller
    // must not swallow the rejection into a bogus 200.
    await expect(
      createTasksController(model).list(
        makeRequest(),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toThrow("db down");
  });

  it("throws the 400 HttpError envelope when q is an array", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });
    const res = makeResponse();

    await expect(
      createTasksController(model).list(
        makeRequest({ query: { q: ["navigation", "breakpoint"] } }),
        asExpressResponse(res),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: { error: "q must be a single value" },
    });

    // No query may run for a request the API refused.
    expect(list).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("throws the reference's status message for an unknown status", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await expect(
      createTasksController(model).list(
        makeRequest({ query: { status: "bogus" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: { error: "Unknown task status: bogus" },
    });

    expect(list).not.toHaveBeenCalled();
  });

  it("throws 400 for a non-integer filter id", async () => {
    const model = makeModel();

    await expect(
      createTasksController(model).list(
        makeRequest({ query: { projectId: "one" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: { error: "projectId must be an integer" },
    });
  });
});

describe("TasksController.count", () => {
  it("responds 200 with the model's count", async () => {
    const model = makeModel({ count: vi.fn().mockResolvedValue(6) });
    const res = makeResponse();

    await createTasksController(model).count(
      makeRequest(),
      asExpressResponse(res),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ count: 6 });
  });

  it("shares the list's filters", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const model = makeModel({ count });

    await createTasksController(model).count(
      makeRequest({ query: { q: "nav", status: "done" } }),
      asExpressResponse(makeResponse()),
    );

    expect(count).toHaveBeenCalledWith({
      search: "nav",
      status: "done",
      cursor: null,
    });
  });
});

describe("TasksController.get", () => {
  it("responds 200 with the model's row", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(TASK) });
    const res = makeResponse();

    await createTasksController(model).get(
      makeRequest({ params: { id: "101" } }),
      asExpressResponse(res),
    );

    expect(model.get).toHaveBeenCalledWith(101);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(TASK);
  });

  it("throws the plain 404 envelope when the row is missing", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(null) });

    await expect(
      createTasksController(model).get(
        makeRequest({ params: { id: "999" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 404,
      payload: { error: "Not found" },
    });
  });

  it("throws 400 for a non-integer id", async () => {
    const model = makeModel();

    await expect(
      createTasksController(model).get(
        makeRequest({ params: { id: "abc" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: { error: "id must be a positive integer" },
    });
  });
});

describe("TasksController.create", () => {
  const BODY = {
    projectId: 1,
    assigneeId: 2,
    title: "Unit task",
    description: "A task from the unit fixture.",
    status: "todo",
  };

  it("responds 201 with the success envelope pointing at the new row", async () => {
    const model = makeModel({
      resolveRefs: vi.fn().mockResolvedValue({ errors: {} }),
      create: vi.fn().mockResolvedValue({ id: 101 }),
    });
    const res = makeResponse();

    await createTasksController(model).create(
      makeRequest({ body: BODY }),
      asExpressResponse(res),
    );

    expect(model.create).toHaveBeenCalledWith({
      projectId: 1,
      assigneeId: 2,
      title: "Unit task",
      description: "A task from the unit fixture.",
      status: "todo",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      message: "Task created.",
      redirectTo: "/tasks/101",
    });
  });

  it("throws the reference's field-error envelope for a bad body", async () => {
    const model = makeModel();
    const res = makeResponse();

    await expect(
      createTasksController(model).create(
        makeRequest({ body: { projectId: 1, title: "", status: "todo" } }),
        asExpressResponse(res),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: {
        error: "Missing fields. Failed to create task.",
        errors: { title: ["Title is required."] },
      },
    });

    // Nothing may be written for a body the API refused.
    expect(model.resolveRefs).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it("throws the choose-a-project error for an unresolvable project id", async () => {
    const model = makeModel();

    await expect(
      createTasksController(model).create(
        makeRequest({ body: { ...BODY, projectId: "one" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: {
        error: "Missing fields. Failed to create task.",
        errors: { projectId: ["Choose a project."] },
      },
    });
  });

  it("throws the reference's existence error when resolveRefs misses", async () => {
    const model = makeModel({
      resolveRefs: vi.fn().mockResolvedValue({
        errors: { assigneeId: ["That assignee no longer exists."] },
      }),
    });

    await expect(
      createTasksController(model).create(
        makeRequest({ body: { ...BODY, assigneeId: 999 } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: {
        error: "Missing fields. Failed to create task.",
        errors: { assigneeId: ["That assignee no longer exists."] },
      },
    });

    expect(model.create).not.toHaveBeenCalled();
  });
});

describe("TasksController.update", () => {
  const BODY = {
    title: "Renamed",
    description: "d",
    status: "done",
    assigneeId: null,
  };

  it("responds 200 with the success envelope pointing at the row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "ok" }),
    });
    const res = makeResponse();

    await createTasksController(model).update(
      makeRequest({ params: { id: "101" }, body: BODY }),
      asExpressResponse(res),
    );

    // assigneeId: null is the explicit "unassigned" choice, not an omission.
    expect(model.update).toHaveBeenCalledWith(101, {
      title: "Renamed",
      description: "d",
      status: "done",
      assigneeId: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      message: "Task updated.",
      redirectTo: "/tasks/101",
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "missing" }),
    });

    await expect(
      createTasksController(model).update(
        makeRequest({ params: { id: "999" }, body: BODY }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 404,
      payload: { error: "That task no longer exists." },
    });
  });

  it("throws the assignee field error when the assignee is gone", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "assignee-missing" }),
    });

    await expect(
      createTasksController(model).update(
        makeRequest({
          params: { id: "101" },
          body: { ...BODY, assigneeId: 999 },
        }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: {
        error: "Missing fields. Failed to update task.",
        errors: { assigneeId: ["That assignee no longer exists."] },
      },
    });
  });
});

describe("TasksController.remove", () => {
  it("responds 200 with the redirect to the deleted task's board", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({ projectId: 1 }),
    });
    const res = makeResponse();

    await createTasksController(model).remove(
      makeRequest({ params: { id: "101" } }),
      asExpressResponse(res),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      message: "Task deleted.",
      redirectTo: "/projects/1",
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({ remove: vi.fn().mockResolvedValue(null) });

    await expect(
      createTasksController(model).remove(
        makeRequest({ params: { id: "999" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 404,
      payload: { error: "That task no longer exists." },
    });
  });
});

describe("TasksController.addComment", () => {
  it("responds 201 with ok only — the reference's createComment has no redirect", async () => {
    const model = makeModel({
      addComment: vi.fn().mockResolvedValue({ status: "ok" }),
    });
    const res = makeResponse();

    await createTasksController(model).addComment(
      makeRequest({
        params: { id: "101" },
        body: { body: "A note.", authorId: 1 },
      }),
      asExpressResponse(res),
    );

    expect(model.addComment).toHaveBeenCalledWith(101, {
      body: "A note.",
      authorId: 1,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it("throws the reference's 404 message when the task is gone", async () => {
    const model = makeModel({
      addComment: vi.fn().mockResolvedValue({ status: "task-missing" }),
    });

    await expect(
      createTasksController(model).addComment(
        makeRequest({
          params: { id: "999" },
          body: { body: "A note.", authorId: 1 },
        }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 404,
      payload: { error: "That task no longer exists." },
    });
  });

  it("throws the author field error when the author is gone", async () => {
    const model = makeModel({
      addComment: vi.fn().mockResolvedValue({ status: "author-missing" }),
    });

    await expect(
      createTasksController(model).addComment(
        makeRequest({
          params: { id: "101" },
          body: { body: "A note.", authorId: 999 },
        }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: {
        error: "Missing fields. Failed to add the comment.",
        errors: { authorId: ["That comment author no longer exists."] },
      },
    });
  });

  it("throws the comment field error for an empty body", async () => {
    const model = makeModel();

    await expect(
      createTasksController(model).addComment(
        makeRequest({ params: { id: "101" }, body: { body: "", authorId: 1 } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: {
        error: "Missing fields. Failed to add the comment.",
        errors: { body: ["Comment is required."] },
      },
    });

    expect(model.addComment).not.toHaveBeenCalled();
  });
});

describe("TasksController.createWithComment", () => {
  const BODY = {
    projectId: 1,
    assigneeId: null,
    title: "Unit task",
    description: "",
    status: "todo",
    commentBody: "First comment.",
    commentAuthorId: 2,
  };

  it("responds 201 with the success envelope pointing at the new row", async () => {
    const model = makeModel({
      resolveRefs: vi.fn().mockResolvedValue({ errors: {} }),
      createWithComment: vi.fn().mockResolvedValue({ status: "ok", id: 107 }),
    });
    const res = makeResponse();

    await createTasksController(model).createWithComment(
      makeRequest({ body: BODY }),
      asExpressResponse(res),
    );

    expect(model.createWithComment).toHaveBeenCalledWith({
      projectId: 1,
      assigneeId: null,
      title: "Unit task",
      description: "",
      status: "todo",
      commentBody: "First comment.",
      commentAuthorId: 2,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      message: "Task created.",
      redirectTo: "/tasks/107",
    });
  });

  it("throws the comment's own field errors, with the task's message", async () => {
    const model = makeModel();

    await expect(
      createTasksController(model).createWithComment(
        makeRequest({ body: { ...BODY, commentBody: "" } }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: {
        error: "Missing fields. Failed to create the task.",
        errors: { commentBody: ["Comment is required."] },
      },
    });
  });

  it("throws the reference's author error, filed under assigneeId as it files it", async () => {
    const model = makeModel({
      resolveRefs: vi.fn().mockResolvedValue({ errors: {} }),
      createWithComment: vi
        .fn()
        .mockResolvedValue({ status: "author-missing" }),
    });

    await expect(
      createTasksController(model).createWithComment(
        makeRequest({ body: BODY }),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toMatchObject({
      status: 400,
      payload: {
        error: "Missing fields. Failed to create the task.",
        errors: { assigneeId: ["That comment author no longer exists."] },
      },
    });
  });
});
