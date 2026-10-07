// tests/integration/tasks.writes.integration.test.ts
//
// The write procedures behind the task forms: tasks.create / update / remove,
// the transactional tasks.createWithComment, and tasks.addComment. Exercises
// the full stack (Express mount → RPCHandler → router → model → Postgres)
// through an oRPC client against the seeded test database — the same RPCLink
// transport the SPA's client uses — and asserts the exact envelopes the
// reference variant's actions produce (message strings verbatim, field errors
// keyed by body field, FK guards) plus the committed state a mutation must
// leave behind. Write inputs are the form's field bag: every field a loose
// string or null, exactly as a <form> submits.
//
// The writes run in order in this file, and the file is self-contained: the
// suite's setup re-seeds the database per file, so every read here starts from
// the fixture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startRpcServer, stopRpcServer } from "../helpers/rpc-server.ts";
import type { RpcServer } from "../helpers/rpc-server.ts";
import { createConnection } from "../../src/db/connection.ts";
import { createTasksModel } from "../../src/tasks/tasks.model.ts";
import { e2eConnectionString } from "../helpers/database.ts";

const CREATE_BODY = {
  projectId: "1",
  assigneeId: "2",
  title: "Audit the navigation copy",
  description: "Re-read every navigation label against the new IA.",
  status: "todo",
};

let rpc: RpcServer;

beforeAll(() => {
  rpc = startRpcServer();
});

afterAll(async () => {
  await stopRpcServer(rpc.server);
});

describe("tasks.create", () => {
  it("creates the task and redirects to its detail page", async () => {
    const result = await rpc.client.tasks.create(CREATE_BODY);

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Task created.");
    expect(result.redirectTo).toMatch(/^\/tasks\/\d+$/);

    // A persisted id must have been allocated (spec/contract.md): the redirect
    // target resolves to the committed row.
    const id = Number(result.redirectTo!.split("/")[2]);
    const detail = await rpc.client.tasks.byId({ id });

    expect(detail).toMatchObject({
      id,
      projectId: 1,
      title: "Audit the navigation copy",
      status: "todo",
      assigneeName: "Alex Morgan",
    });
  });

  it("sets created_at and updated_at equal at insert", async () => {
    const created = await rpc.client.tasks.create({
      ...CREATE_BODY,
      title: "Timestamp probe",
    });
    const id = Number(created.redirectTo!.split("/")[2]);

    // created_at is only exposed on the board's rows (createdAtRaw, the
    // cursor component) and updated_at on every row: the two must agree to the
    // second, which is the fixture's precision and the display contract.
    const board = await rpc.client.projects.tasks({ id: 1 });
    const row = board.find((task) => task.id === id);

    expect(row!.createdAtRaw.slice(0, 19)).toBe(row!.updatedAt.slice(0, 19));
  });

  it("creates an unassigned task when assigneeId is null", async () => {
    const created = await rpc.client.tasks.create({
      ...CREATE_BODY,
      assigneeId: null,
    });

    const id = Number(created.redirectTo!.split("/")[2]);
    const detail = await rpc.client.tasks.byId({ id });

    expect(detail.assigneeName).toBe("Unassigned");
  });

  it("reports the reference's field errors for an invalid body", async () => {
    await expect(
      rpc.client.tasks.create({ ...CREATE_BODY, title: "", status: "bogus" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create task.",
        errors: {
          title: ["Title is required."],
          status: ["Choose a valid status."],
        },
      },
    });
  });

  it("reports an omitted title exactly as the reference's form does", async () => {
    await expect(
      rpc.client.tasks.create({ projectId: "1", status: "todo" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create task.",
        errors: { title: ["Invalid input: expected string, received null"] },
      },
    });
  });

  it("reports the reference's choose-a-project error for a bad project id", async () => {
    await expect(
      rpc.client.tasks.create({ ...CREATE_BODY, projectId: "one" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create task.",
        errors: { projectId: ["Choose a project."] },
      },
    });
  });

  it("reports the reference's existence errors for unknown project or assignee", async () => {
    await expect(
      rpc.client.tasks.create({ ...CREATE_BODY, projectId: "999" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create task.",
        errors: { projectId: ["That project no longer exists."] },
      },
    });

    await expect(
      rpc.client.tasks.create({ ...CREATE_BODY, assigneeId: "999" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create task.",
        errors: { assigneeId: ["That assignee no longer exists."] },
      },
    });
  });

  it("inserts nothing for a refused body", async () => {
    const before = await rpc.client.tasks.count({});

    await expect(
      rpc.client.tasks.create({ ...CREATE_BODY, projectId: "999" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const after = await rpc.client.tasks.count({});

    expect(after).toBe(before);
  });
});

describe("tasks.update", () => {
  it("updates the task, advances updated_at, and redirects to it", async () => {
    const before = await rpc.client.tasks.byId({ id: 102 });

    const result = await rpc.client.tasks.update({
      id: 102,
      title: "Confirm breakpoint rules (revised)",
      description: "Agree the breakpoints, including the tablet one.",
      status: "in progress",
      assigneeId: "1",
    });

    expect(result).toEqual({
      ok: true,
      message: "Task updated.",
      redirectTo: "/tasks/102",
    });

    const after = await rpc.client.tasks.byId({ id: 102 });

    expect(after).toMatchObject({
      id: 102,
      title: "Confirm breakpoint rules (revised)",
      description: "Agree the breakpoints, including the tablet one.",
      status: "in progress",
      assigneeName: "Robin Andrew",
    });

    // spec/queries.md: the statement must explicitly advance updated_at.
    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect(after.updatedAt > "2026-09-28T11:20:00Z").toBe(true);
  });

  it("unassigns the task when assigneeId is null", async () => {
    const result = await rpc.client.tasks.update({
      id: 102,
      title: "Confirm breakpoint rules",
      description:
        "Agree the breakpoints the shared layout tokens are generated from.",
      status: "todo",
      assigneeId: null,
    });

    expect(result.ok).toBe(true);

    const after = await rpc.client.tasks.byId({ id: 102 });

    expect(after.assigneeName).toBe("Unassigned");
  });

  it("reports the reference's field errors for an invalid body", async () => {
    await expect(
      rpc.client.tasks.update({ id: 102, description: "d", status: "later" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to update task.",
        errors: {
          title: ["Invalid input: expected string, received null"],
          status: ["Choose a valid status."],
        },
      },
    });
  });

  it("reports the reference's assignee existence error", async () => {
    await expect(
      rpc.client.tasks.update({
        id: 102,
        title: "Confirm breakpoint rules",
        description:
          "Agree the breakpoints the shared layout tokens are generated from.",
        status: "todo",
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

  it("returns the reference's 404 message for an unknown task", async () => {
    await expect(
      rpc.client.tasks.update({
        id: 999,
        title: "No such task",
        description: "",
        status: "todo",
        assigneeId: null,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That task no longer exists." },
    });
  });
});

describe("tasks.remove", () => {
  async function createTask(title: string) {
    const created = await rpc.client.tasks.create({
      projectId: "1",
      assigneeId: null,
      title,
      description: "A task the delete tests own.",
      status: "todo",
    });

    return Number(created.redirectTo!.split("/")[2]);
  }

  it("deletes the task and redirects to its project board", async () => {
    const id = await createTask("Delete me");

    const result = await rpc.client.tasks.remove({ id });

    expect(result).toEqual({
      ok: true,
      message: "Task deleted.",
      redirectTo: "/projects/1",
    });

    // The committed absence: not in the list, not-found on direct navigation.
    await expect(rpc.client.tasks.byId({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "Not found" },
    });
  });

  it("cascades the task's comments away with it", async () => {
    const id = await createTask("Delete me with my comments");

    await rpc.client.tasks.addComment({
      id,
      body: "A comment that must not outlive its task.",
      authorId: "1",
    });

    await rpc.client.tasks.remove({ id });

    const comments = await rpc.client.tasks.comments({ id });

    // Mirror getComments: a query scoped to a task that no longer exists
    // returns its (empty) comment list, not an error.
    expect(comments).toEqual([]);
  });

  it("returns the reference's 404 message for an unknown task", async () => {
    await expect(rpc.client.tasks.remove({ id: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That task no longer exists." },
    });
  });
});

describe("tasks.createWithComment", () => {
  const BODY = {
    projectId: "1",
    assigneeId: "1",
    title: "Publish the navigation copy",
    description: "Ship the agreed labels.",
    status: "todo",
    commentBody: "Copy is finalised and ready to publish.",
    commentAuthorId: "2",
  };

  it("creates the task and its first comment in one transaction", async () => {
    const result = await rpc.client.tasks.createWithComment(BODY);

    expect(result.ok).toBe(true);
    expect(result.redirectTo).toMatch(/^\/tasks\/\d+$/);

    const id = Number(result.redirectTo!.split("/")[2]);

    // Both halves of the transaction are visible: the task row, and the one
    // comment it was created with.
    const detail = await rpc.client.tasks.byId({ id });
    const comments = await rpc.client.tasks.comments({ id });

    expect(detail).toMatchObject({ id, commentCount: 1 });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      taskId: id,
      authorName: "Alex Morgan",
      body: "Copy is finalised and ready to publish.",
    });
  });

  it("reports the comment's own field errors with the task's message", async () => {
    await expect(
      rpc.client.tasks.createWithComment({ ...BODY, commentBody: "" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create the task.",
        errors: { commentBody: ["Comment is required."] },
      },
    });
  });

  it("reports the reference's author error, filed where the reference files it", async () => {
    await expect(
      rpc.client.tasks.createWithComment({ ...BODY, commentAuthorId: "999" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to create the task.",
        errors: { assigneeId: ["That comment author no longer exists."] },
      },
    });
  });

  it("rolls back the task when the comment insert fails", async () => {
    // The contract pre-validates everything the schema constrains, so a
    // mid-transaction failure has to be provoked at the model layer — the same
    // rollback path the procedure provides. A body over the CHECK on
    // comments.body passes the endpoint's own checks only when the model is
    // called directly, and the task insert must not survive it.
    const model = createTasksModel(createConnection(e2eConnectionString()));

    await expect(
      model.createWithComment({
        projectId: 1,
        assigneeId: null,
        title: "Must not survive a failed comment",
        description: "",
        status: "todo",
        commentBody: "x".repeat(1001),
        commentAuthorId: 1,
      }),
    ).rejects.toThrow();

    // No partial state: neither the task nor its comment exists.
    const search = await rpc.client.tasks.list({
      q: "Must not survive a failed comment",
    });

    expect(search).toEqual([]);
  });
});

describe("tasks.addComment", () => {
  it("adds the comment and replies ok with no redirect, like the reference", async () => {
    const result = await rpc.client.tasks.addComment({
      id: 101,
      body: "A new comment from the integration suite.",
      authorId: "3",
    });

    // The reference's createComment returns no redirectTo — the user stays on
    // the detail page — so the reply is the ok marker alone.
    expect(result).toEqual({ ok: true });

    const comments = await rpc.client.tasks.comments({ id: 101 });

    // Newest first: the fresh comment leads the list.
    expect(comments).toHaveLength(3);
    expect(comments[0]).toMatchObject({
      taskId: 101,
      authorName: "Sam Taylor",
      body: "A new comment from the integration suite.",
    });
  });

  it("never returns more than the 10 most recent comments", async () => {
    const created = await rpc.client.tasks.create({
      projectId: "2",
      assigneeId: null,
      title: "Comment volume probe",
      description: "",
      status: "todo",
    });
    const id = Number(created.redirectTo!.split("/")[2]);

    // Eleven comments: one more than the bound, so a limit honoured only by
    // luck would show all eleven.
    for (let index = 0; index < 11; index += 1) {
      await rpc.client.tasks.addComment({
        id,
        body: `Comment number ${index}.`,
        authorId: "1",
      });
    }

    const comments = await rpc.client.tasks.comments({ id });

    expect(comments).toHaveLength(10);
    expect(comments[0].body).toBe("Comment number 10.");
    expect(comments[9].body).toBe("Comment number 1.");
  });

  it("reports the reference's field errors for an empty body", async () => {
    await expect(
      rpc.client.tasks.addComment({ id: 101, body: "", authorId: "1" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        error: "Missing fields. Failed to add the comment.",
        errors: { body: ["Comment is required."] },
      },
    });
  });

  it("reports the reference's author error", async () => {
    await expect(
      rpc.client.tasks.addComment({
        id: 101,
        body: "A comment.",
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

  it("returns the reference's 404 message for an unknown task", async () => {
    await expect(
      rpc.client.tasks.addComment({
        id: 999,
        body: "A comment.",
        authorId: "1",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { error: "That task no longer exists." },
    });
  });
});
