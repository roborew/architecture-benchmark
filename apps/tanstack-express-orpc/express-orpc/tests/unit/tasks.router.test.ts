// tests/unit/tasks.router.test.ts
//
// The tasks router's contract with the model stubbed: what it sends to the
// model, what it resolves to, and which ORPCError it throws for each refused
// outcome. No database, no HTTP — the procedure is driven in process through
// `call`, which is the same entry the RPC handler uses, minus the transport.
//
// This replaces the REST variant's tasks.controller.test.ts: the router is the
// controller now, and the outcomes the controller wrote to the response
// (status codes + JSON envelopes) are carried by the ORPCError codes and the
// error envelope in its `data` (src/orpc/errors.ts owns the mapping).
//
// Write inputs are the form's field bag (strings for every field) exactly as
// the SPA submits them, so the value normalisation the server owns (a numeric
// string is a row id, "" or null mean unassigned) is exercised on the same
// path production takes.

import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";

import type { TasksModel } from "../../src/tasks/tasks.model.ts";
import { createTasksRouter } from "../../src/orpc/routers/tasks.ts";

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

const TASK_ROW = {
  id: 101,
  projectId: 1,
  projectName: "Unit Project",
  title: "Unit task",
  description: "A task from the unit fixture.",
  status: "todo",
  assigneeName: "Unit Person",
  commentCount: 0,
  updatedAt: "2026-09-29T08:00:00Z",
  updatedAtRaw: "2026-09-29T08:00:00.000000Z",
  cursorFor: "Y3Vyc29y",
};

describe("tasks.list", () => {
  it("resolves with the model's rows", async () => {
    const model = makeModel({ list: vi.fn().mockResolvedValue([TASK_ROW]) });

    const rows = await call(createTasksRouter(model).list, {});

    expect(rows).toEqual([TASK_ROW]);
  });

  it("passes the parsed filters to the model", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await call(createTasksRouter(model).list, {
      q: "  navigation  ",
      status: " todo ",
      projectId: 2,
      assigneeId: 4,
      cursor: "Y3Vyc29y",
      limit: 6,
    });

    expect(list).toHaveBeenCalledWith({
      search: "navigation",
      status: "todo",
      projectId: 2,
      assigneeId: 4,
      cursor: "Y3Vyc29y",
      limit: 6,
    });
  });

  it("normalises absent filters to the model's defaults", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await call(createTasksRouter(model).list, {});

    expect(list).toHaveBeenCalledWith({
      search: "",
      status: "",
      cursor: null,
    });
  });

  it("rejects when the model rejects", async () => {
    const model = makeModel({
      list: vi.fn().mockRejectedValue(new Error("db down")),
    });

    await expect(call(createTasksRouter(model).list, {})).rejects.toThrow(
      "db down",
    );
  });

  it("throws the reference's status message for an unknown status", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await expect(
      call(createTasksRouter(model).list, { status: "bogus" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { error: "Unknown task status: bogus" },
    });

    // No query may run for a call the router refused.
    expect(list).not.toHaveBeenCalled();
  });

  it("throws the 400 envelope when q exceeds 100 characters", async () => {
    const model = makeModel();

    await expect(
      call(createTasksRouter(model).list, { q: "a".repeat(101) }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { error: "q must be at most 100 characters" },
    });
  });
});

describe("tasks.count", () => {
  it("resolves with the model's count, as the bare number", async () => {
    const model = makeModel({ count: vi.fn().mockResolvedValue(6) });

    const count = await call(createTasksRouter(model).count, {});

    expect(count).toBe(6);
  });

  it("shares the list's filters, without the paging", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const model = makeModel({ count });

    await call(createTasksRouter(model).count, {
      q: "nav",
      status: "done",
      projectId: 2,
    });

    expect(count).toHaveBeenCalledWith({
      search: "nav",
      status: "done",
      projectId: 2,
      cursor: null,
    });
  });
});

describe("tasks.byId", () => {
  it("resolves with the model's row", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(TASK) });

    const task = await call(createTasksRouter(model).byId, { id: 101 });

    expect(model.get).toHaveBeenCalledWith(101);
    expect(task).toEqual(TASK);
  });

  it("throws the NOT_FOUND envelope when the row is missing", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(null) });

    await expect(
      call(createTasksRouter(model).byId, { id: 999 }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "Not found" },
    });
  });
});

describe("tasks.comments", () => {
  it("resolves with the model's rows, scoped by the id", async () => {
    const comment = {
      id: 1,
      taskId: 101,
      authorName: "Unit Person",
      body: "A note.",
      createdAt: "2026-09-29T08:00:00Z",
    };
    const model = makeModel({
      listComments: vi.fn().mockResolvedValue([comment]),
    });

    const comments = await call(createTasksRouter(model).comments, { id: 101 });

    expect(model.listComments).toHaveBeenCalledWith(101);
    expect(comments).toEqual([comment]);
  });
});

describe("tasks.create", () => {
  const BODY = {
    projectId: "1",
    assigneeId: "2",
    title: "Unit task",
    description: "A task from the unit fixture.",
    status: "todo",
  };

  it("resolves with the success envelope pointing at the new row", async () => {
    const model = makeModel({
      resolveRefs: vi.fn().mockResolvedValue({ errors: {} }),
      create: vi.fn().mockResolvedValue({ id: 101 }),
    });

    const result = await call(createTasksRouter(model).create, BODY);

    expect(model.create).toHaveBeenCalledWith({
      projectId: 1,
      assigneeId: 2,
      title: "Unit task",
      description: "A task from the unit fixture.",
      status: "todo",
    });
    expect(result).toEqual({
      ok: true,
      message: "Task created.",
      redirectTo: "/tasks/101",
    });
  });

  it("throws the reference's field-error envelope for a bad body", async () => {
    const model = makeModel();

    await expect(
      call(createTasksRouter(model).create, {
        ...BODY,
        title: "",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create task.",
        errors: { title: ["Title is required."] },
      },
    });

    // Nothing may be written for a body the router refused.
    expect(model.resolveRefs).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it("throws the choose-a-project error for an unresolvable project id", async () => {
    const model = makeModel();

    await expect(
      call(createTasksRouter(model).create, { ...BODY, projectId: "one" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create task.",
        errors: { projectId: ["Choose a project."] },
      },
    });
  });

  it("treats an empty assignee as the explicit unassigned choice", async () => {
    const model = makeModel({
      resolveRefs: vi.fn().mockResolvedValue({ errors: {} }),
      create: vi.fn().mockResolvedValue({ id: 101 }),
    });

    await call(createTasksRouter(model).create, { ...BODY, assigneeId: "" });

    expect(model.resolveRefs).toHaveBeenCalledWith(1, null);
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: null }),
    );
  });

  it("throws the reference's existence error when resolveRefs misses", async () => {
    const model = makeModel({
      resolveRefs: vi.fn().mockResolvedValue({
        errors: { assigneeId: ["That assignee no longer exists."] },
      }),
    });

    await expect(
      call(createTasksRouter(model).create, { ...BODY, assigneeId: "999" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create task.",
        errors: { assigneeId: ["That assignee no longer exists."] },
      },
    });

    expect(model.create).not.toHaveBeenCalled();
  });
});

describe("tasks.update", () => {
  const BODY = {
    title: "Renamed",
    description: "d",
    status: "done",
    assigneeId: null,
  };

  it("resolves with the success envelope pointing at the row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    const result = await call(createTasksRouter(model).update, {
      id: 101,
      ...BODY,
    });

    // assigneeId: null is the explicit "unassigned" choice, not an omission.
    expect(model.update).toHaveBeenCalledWith(101, {
      title: "Renamed",
      description: "d",
      status: "done",
      assigneeId: null,
    });
    expect(result).toEqual({
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
      call(createTasksRouter(model).update, { id: 999, ...BODY }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That task no longer exists." },
    });
  });

  it("throws the assignee field error when the assignee is gone", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "assignee-missing" }),
    });

    await expect(
      call(createTasksRouter(model).update, {
        id: 101,
        ...BODY,
        assigneeId: "999",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to update task.",
        errors: { assigneeId: ["That assignee no longer exists."] },
      },
    });
  });
});

describe("tasks.remove", () => {
  it("resolves with the redirect to the deleted task's board", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({ projectId: 1 }),
    });

    const result = await call(createTasksRouter(model).remove, { id: 101 });

    expect(result).toEqual({
      ok: true,
      message: "Task deleted.",
      redirectTo: "/projects/1",
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({ remove: vi.fn().mockResolvedValue(null) });

    await expect(
      call(createTasksRouter(model).remove, { id: 999 }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That task no longer exists." },
    });
  });
});

describe("tasks.addComment", () => {
  it("resolves with ok only — the reference's createComment has no redirect", async () => {
    const model = makeModel({
      addComment: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    const result = await call(createTasksRouter(model).addComment, {
      id: 101,
      body: "A note.",
      authorId: "1",
    });

    expect(model.addComment).toHaveBeenCalledWith(101, {
      body: "A note.",
      authorId: 1,
    });
    expect(result).toEqual({ ok: true });
  });

  it("throws the reference's 404 message when the task is gone", async () => {
    const model = makeModel({
      addComment: vi.fn().mockResolvedValue({ status: "task-missing" }),
    });

    await expect(
      call(createTasksRouter(model).addComment, {
        id: 999,
        body: "A note.",
        authorId: "1",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That task no longer exists." },
    });
  });

  it("throws the author field error when the author is gone", async () => {
    const model = makeModel({
      addComment: vi.fn().mockResolvedValue({ status: "author-missing" }),
    });

    await expect(
      call(createTasksRouter(model).addComment, {
        id: 101,
        body: "A note.",
        authorId: "999",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to add the comment.",
        errors: { authorId: ["That comment author no longer exists."] },
      },
    });
  });

  it("throws the comment field error for an empty body", async () => {
    const model = makeModel();

    await expect(
      call(createTasksRouter(model).addComment, {
        id: 101,
        body: "",
        authorId: "1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to add the comment.",
        errors: { body: ["Comment is required."] },
      },
    });

    expect(model.addComment).not.toHaveBeenCalled();
  });
});

describe("tasks.createWithComment", () => {
  const BODY = {
    projectId: "1",
    assigneeId: null,
    title: "Unit task",
    description: "",
    status: "todo",
    commentBody: "First comment.",
    commentAuthorId: "2",
  };

  it("resolves with the success envelope pointing at the new row", async () => {
    const model = makeModel({
      resolveRefs: vi.fn().mockResolvedValue({ errors: {} }),
      createWithComment: vi.fn().mockResolvedValue({ status: "ok", id: 107 }),
    });

    const result = await call(createTasksRouter(model).createWithComment, BODY);

    expect(model.createWithComment).toHaveBeenCalledWith({
      projectId: 1,
      assigneeId: null,
      title: "Unit task",
      description: "",
      status: "todo",
      commentBody: "First comment.",
      commentAuthorId: 2,
    });
    expect(result).toEqual({
      ok: true,
      message: "Task created.",
      redirectTo: "/tasks/107",
    });
  });

  it("throws the comment's own field errors, with the task's message", async () => {
    const model = makeModel();

    await expect(
      call(createTasksRouter(model).createWithComment, {
        ...BODY,
        commentBody: "",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
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
      call(createTasksRouter(model).createWithComment, BODY),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create the task.",
        errors: { assigneeId: ["That comment author no longer exists."] },
      },
    });
  });
});
