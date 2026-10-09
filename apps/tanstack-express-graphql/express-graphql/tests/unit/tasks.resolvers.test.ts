// tests/unit/tasks.resolvers.test.ts
//
// The task resolvers' contract with the model stubbed: what they send to the
// model, what they resolve to, and which GraphQLError they throw for each
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
// The mutation arguments are the form's field bag of strings (the schema types
// them String, not Int): the validators own every coercion rule, exactly as
// they owned it over REST. The read arguments are typed, but the resolver
// still funnels them through the shared validators as the string bag they were
// written for — an unknown `status` or an id that cannot name a row is
// therefore a BAD_INPUT error with the old message, before the model sees it.

import { describe, expect, it, vi } from "vitest";

import { createTasksResolvers } from "../../src/tasks/tasks.resolvers.ts";
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

describe("TasksResolvers.Query.tasks", () => {
  it("resolves with the model's rows", async () => {
    const model = makeModel({ list: vi.fn().mockResolvedValue([TASK]) });

    await expect(
      createTasksResolvers(model).Query.tasks(null, {}),
    ).resolves.toEqual([TASK]);
  });

  it("passes the parsed filters to the model", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await createTasksResolvers(model).Query.tasks(null, {
      q: "  navigation  ",
      status: " todo ",
    });

    expect(list).toHaveBeenCalledWith({
      search: "navigation",
      status: "todo",
      cursor: null,
    });
  });

  it("rejects when the model rejects, so Yoga's masked-error path carries it", async () => {
    const model = makeModel({
      list: vi.fn().mockRejectedValue(new Error("db down")),
    });

    // A model failure must propagate out of the resolver as a rejection:
    // Yoga masks it as "Internal server error" at the HTTP edge, but only a
    // resolver that actually rejects gets there — one that swallowed the
    // rejection would answer a bogus success instead.
    await expect(
      createTasksResolvers(model).Query.tasks(null, {}),
    ).rejects.toThrow("db down");
  });

  it("throws BAD_INPUT for a q that is not a single value", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    // GraphQL types `q` as String, so a client cannot send an array — but the
    // resolver funnels whatever it receives through the shared validator,
    // whose single-value rule (the REST `?q=a&q=b` guard) stays the contract.
    await expect(
      createTasksResolvers(model).Query.tasks(null, {
        q: ["navigation", "breakpoint"] as unknown as string,
      }),
    ).rejects.toMatchObject({
      message: "q must be a single value",
      extensions: { code: "BAD_INPUT" },
    });

    // No query may run for arguments the resolver refused.
    expect(list).not.toHaveBeenCalled();
  });

  it("throws the reference's status message for an unknown status", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel({ list });

    await expect(
      createTasksResolvers(model).Query.tasks(null, { status: "bogus" }),
    ).rejects.toMatchObject({
      message: "Unknown task status: bogus",
      extensions: { code: "BAD_INPUT" },
    });

    expect(list).not.toHaveBeenCalled();
  });

  it("throws BAD_INPUT for a non-integer filter id", async () => {
    const model = makeModel();

    // The Int argument arrives as a string bag entry for the shared validator,
    // which rejects a non-integer exactly as the REST query param was.
    await expect(
      createTasksResolvers(model).Query.tasks(null, {
        projectId: "one" as unknown as number,
      }),
    ).rejects.toMatchObject({
      message: "projectId must be an integer",
      extensions: { code: "BAD_INPUT" },
    });
  });
});

describe("TasksResolvers.Query.taskCount", () => {
  it("resolves with the model's count (the Int, not a wrapper object)", async () => {
    const model = makeModel({ count: vi.fn().mockResolvedValue(6) });

    // REST answered `{ count: 6 }`; GraphQL's Int return is the count itself.
    await expect(
      createTasksResolvers(model).Query.taskCount(null, {}),
    ).resolves.toBe(6);
  });

  it("shares the list's filters", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const model = makeModel({ count });

    await createTasksResolvers(model).Query.taskCount(null, {
      q: "nav",
      status: "done",
    });

    expect(count).toHaveBeenCalledWith({
      search: "nav",
      status: "done",
      cursor: null,
    });
  });
});

describe("TasksResolvers.Query.task", () => {
  it("resolves with the model's row", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(TASK) });

    await expect(
      createTasksResolvers(model).Query.task(null, { id: 101 }),
    ).resolves.toEqual(TASK);

    expect(model.get).toHaveBeenCalledWith(101);
  });

  it("throws NOT_FOUND when the row is missing", async () => {
    const model = makeModel({ get: vi.fn().mockResolvedValue(null) });

    await expect(
      createTasksResolvers(model).Query.task(null, { id: 999 }),
    ).rejects.toMatchObject({
      message: "Not found",
      extensions: { code: "NOT_FOUND" },
    });
  });

  it("throws BAD_INPUT for an id that cannot name a row", async () => {
    const model = makeModel();

    // GraphQL's Int! can carry a non-positive integer — the values that
    // cannot name a primary key — which requireIdArg rejects with the same
    // message the REST :id param guard answered "abc" with.
    await expect(
      createTasksResolvers(model).Query.task(null, { id: 0 }),
    ).rejects.toMatchObject({
      message: "id must be a positive integer",
      extensions: { code: "BAD_INPUT" },
    });
  });
});

describe("TasksResolvers.Mutation.createTask", () => {
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

    await expect(
      createTasksResolvers(model).Mutation.createTask(null, BODY),
    ).resolves.toEqual({
      ok: true,
      message: "Task created.",
      redirectTo: "/tasks/101",
    });

    // The string bag is coerced by the validators, and the model sees the
    // resolved integers — exactly what the REST body's numbers became.
    expect(model.resolveRefs).toHaveBeenCalledWith(1, 2);
    expect(model.create).toHaveBeenCalledWith({
      projectId: 1,
      assigneeId: 2,
      title: "Unit task",
      description: "A task from the unit fixture.",
      status: "todo",
    });
  });

  it("throws the reference's field-error shape for a bad body", async () => {
    const model = makeModel();

    await expect(
      createTasksResolvers(model).Mutation.createTask(null, {
        projectId: "1",
        title: "",
        status: "todo",
      }),
    ).rejects.toMatchObject({
      message: "Missing fields. Failed to create task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { title: ["Title is required."] },
      },
    });

    // Nothing may be written for a body the resolver refused.
    expect(model.resolveRefs).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it("throws the choose-a-project error for an unresolvable project id", async () => {
    const model = makeModel();

    await expect(
      createTasksResolvers(model).Mutation.createTask(null, {
        ...BODY,
        projectId: "one",
      }),
    ).rejects.toMatchObject({
      message: "Missing fields. Failed to create task.",
      extensions: {
        code: "BAD_INPUT",
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
      createTasksResolvers(model).Mutation.createTask(null, {
        ...BODY,
        assigneeId: "999",
      }),
    ).rejects.toMatchObject({
      message: "Missing fields. Failed to create task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { assigneeId: ["That assignee no longer exists."] },
      },
    });

    expect(model.create).not.toHaveBeenCalled();
  });
});

describe("TasksResolvers.Mutation.updateTask", () => {
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

    await expect(
      createTasksResolvers(model).Mutation.updateTask(null, {
        id: 101,
        ...BODY,
      }),
    ).resolves.toEqual({
      ok: true,
      message: "Task updated.",
      redirectTo: "/tasks/101",
    });

    // assigneeId: null is the explicit "unassigned" choice, not an omission.
    expect(model.update).toHaveBeenCalledWith(101, {
      title: "Renamed",
      description: "d",
      status: "done",
      assigneeId: null,
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "missing" }),
    });

    await expect(
      createTasksResolvers(model).Mutation.updateTask(null, {
        id: 999,
        ...BODY,
      }),
    ).rejects.toMatchObject({
      message: "That task no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });

  it("throws the assignee field error when the assignee is gone", async () => {
    const model = makeModel({
      update: vi.fn().mockResolvedValue({ status: "assignee-missing" }),
    });

    await expect(
      createTasksResolvers(model).Mutation.updateTask(null, {
        id: 101,
        ...BODY,
        assigneeId: "999",
      }),
    ).rejects.toMatchObject({
      message: "Missing fields. Failed to update task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { assigneeId: ["That assignee no longer exists."] },
      },
    });
  });
});

describe("TasksResolvers.Mutation.deleteTask", () => {
  it("resolves with the redirect to the deleted task's board", async () => {
    const model = makeModel({
      remove: vi.fn().mockResolvedValue({ projectId: 1 }),
    });

    await expect(
      createTasksResolvers(model).Mutation.deleteTask(null, { id: 101 }),
    ).resolves.toEqual({
      ok: true,
      message: "Task deleted.",
      redirectTo: "/projects/1",
    });
  });

  it("throws the reference's 404 message for a missing row", async () => {
    const model = makeModel({ remove: vi.fn().mockResolvedValue(null) });

    await expect(
      createTasksResolvers(model).Mutation.deleteTask(null, { id: 999 }),
    ).rejects.toMatchObject({
      message: "That task no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });
});

describe("TasksResolvers.Mutation.addTaskComment", () => {
  it("resolves with ok only — the reference's createComment has no redirect", async () => {
    const model = makeModel({
      addComment: vi.fn().mockResolvedValue({ status: "ok" }),
    });

    await expect(
      createTasksResolvers(model).Mutation.addTaskComment(null, {
        taskId: 101,
        body: "A note.",
        authorId: "1",
      }),
    ).resolves.toEqual({ ok: true });

    expect(model.addComment).toHaveBeenCalledWith(101, {
      body: "A note.",
      authorId: 1,
    });
  });

  it("throws the reference's 404 message when the task is gone", async () => {
    const model = makeModel({
      addComment: vi.fn().mockResolvedValue({ status: "task-missing" }),
    });

    await expect(
      createTasksResolvers(model).Mutation.addTaskComment(null, {
        taskId: 999,
        body: "A note.",
        authorId: "1",
      }),
    ).rejects.toMatchObject({
      message: "That task no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });

  it("throws the author field error when the author is gone", async () => {
    const model = makeModel({
      addComment: vi.fn().mockResolvedValue({ status: "author-missing" }),
    });

    await expect(
      createTasksResolvers(model).Mutation.addTaskComment(null, {
        taskId: 101,
        body: "A note.",
        authorId: "999",
      }),
    ).rejects.toMatchObject({
      message: "Missing fields. Failed to add the comment.",
      extensions: {
        code: "BAD_INPUT",
        errors: { authorId: ["That comment author no longer exists."] },
      },
    });
  });

  it("throws the comment field error for an empty body", async () => {
    const model = makeModel();

    await expect(
      createTasksResolvers(model).Mutation.addTaskComment(null, {
        taskId: 101,
        body: "",
        authorId: "1",
      }),
    ).rejects.toMatchObject({
      message: "Missing fields. Failed to add the comment.",
      extensions: {
        code: "BAD_INPUT",
        errors: { body: ["Comment is required."] },
      },
    });

    expect(model.addComment).not.toHaveBeenCalled();
  });
});

describe("TasksResolvers.Mutation.createTaskWithComment", () => {
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

    await expect(
      createTasksResolvers(model).Mutation.createTaskWithComment(null, BODY),
    ).resolves.toEqual({
      ok: true,
      message: "Task created.",
      redirectTo: "/tasks/107",
    });

    expect(model.createWithComment).toHaveBeenCalledWith({
      projectId: 1,
      assigneeId: null,
      title: "Unit task",
      description: "",
      status: "todo",
      commentBody: "First comment.",
      commentAuthorId: 2,
    });
  });

  it("throws the comment's own field errors, with the task's message", async () => {
    const model = makeModel();

    await expect(
      createTasksResolvers(model).Mutation.createTaskWithComment(null, {
        ...BODY,
        commentBody: "",
      }),
    ).rejects.toMatchObject({
      message: "Missing fields. Failed to create the task.",
      extensions: {
        code: "BAD_INPUT",
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
      createTasksResolvers(model).Mutation.createTaskWithComment(null, BODY),
    ).rejects.toMatchObject({
      message: "Missing fields. Failed to create the task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { assigneeId: ["That comment author no longer exists."] },
      },
    });
  });
});
