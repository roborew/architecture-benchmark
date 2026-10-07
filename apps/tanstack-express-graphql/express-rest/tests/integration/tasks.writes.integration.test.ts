// tests/integration/tasks.writes.integration.test.ts
//
// The write surface behind the task forms: POST/PATCH/DELETE /api/tasks, the
// transactional POST /api/tasks/with-comment, and POST /api/tasks/:id/comments.
// Exercises the full HTTP stack (routes → controller → model → Postgres)
// through supertest against the seeded test database, and asserts the exact
// envelopes the reference variant's actions produce (message strings verbatim,
// field errors keyed by body field, FK guards) plus the committed state a
// mutation must leave behind.
//
// The writes run after the reads in this file, and the file is self-contained:
// the suite's setup re-seeds the database per file, so the reads above always
// start from the fixture.

import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/app.ts";
import { createConnection } from "../../src/db/connection.ts";
import { createTasksModel } from "../../src/tasks/tasks.model.ts";
import { e2eConnectionString } from "../helpers/database.ts";

const CREATE_BODY = {
  projectId: 1,
  assigneeId: 2,
  title: "Audit the navigation copy",
  description: "Re-read every navigation label against the new IA.",
  status: "todo",
};

describe("POST /api/tasks", () => {
  it("creates the task and redirects to its detail page", async () => {
    const response = await request(createApp())
      .post("/api/tasks")
      .send(CREATE_BODY);

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    expect(response.body.message).toBe("Task created.");
    expect(response.body.redirectTo).toMatch(/^\/tasks\/\d+$/);

    // A persisted id must have been allocated (spec/contract.md): the redirect
    // target resolves to the committed row.
    const id = Number(response.body.redirectTo.split("/")[2]);
    const detail = await request(createApp()).get(`/api/tasks/${id}`);

    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id,
      projectId: 1,
      title: "Audit the navigation copy",
      status: "todo",
      assigneeName: "Alex Morgan",
    });
  });

  it("sets created_at and updated_at equal at insert", async () => {
    const created = await request(createApp())
      .post("/api/tasks")
      .send({ ...CREATE_BODY, title: "Timestamp probe" });
    const id = Number(created.body.redirectTo.split("/")[2]);

    // created_at is only exposed on the board's rows (createdAtRaw, the
    // cursor component) and updated_at on every row: the two must agree to the
    // second, which is the fixture's precision and the display contract.
    const board = await request(createApp()).get("/api/projects/1/tasks");
    const row = board.body.find((task: { id: number }) => task.id === id);

    expect(row.createdAtRaw.slice(0, 19)).toBe(row.updatedAt.slice(0, 19));
  });

  it("creates an unassigned task when assigneeId is null", async () => {
    const response = await request(createApp())
      .post("/api/tasks")
      .send({ ...CREATE_BODY, assigneeId: null });

    const id = Number(response.body.redirectTo.split("/")[2]);
    const detail = await request(createApp()).get(`/api/tasks/${id}`);

    expect(detail.body.assigneeName).toBe("Unassigned");
  });

  it("reports the reference's field errors for an invalid body", async () => {
    const response = await request(createApp())
      .post("/api/tasks")
      .send({ ...CREATE_BODY, title: "", status: "bogus" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to create task.",
      errors: {
        title: ["Title is required."],
        status: ["Choose a valid status."],
      },
    });
  });

  it("reports an omitted title exactly as the reference's form does", async () => {
    const response = await request(createApp())
      .post("/api/tasks")
      .send({ projectId: 1, status: "todo" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to create task.",
      errors: { title: ["Invalid input: expected string, received null"] },
    });
  });

  it("reports the reference's choose-a-project error for a bad project id", async () => {
    const response = await request(createApp())
      .post("/api/tasks")
      .send({ ...CREATE_BODY, projectId: "one" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to create task.",
      errors: { projectId: ["Choose a project."] },
    });
  });

  it("reports the reference's existence errors for unknown project or assignee", async () => {
    const project = await request(createApp())
      .post("/api/tasks")
      .send({ ...CREATE_BODY, projectId: 999 });

    expect(project.status).toBe(400);
    expect(project.body).toEqual({
      error: "Missing fields. Failed to create task.",
      errors: { projectId: ["That project no longer exists."] },
    });

    const assignee = await request(createApp())
      .post("/api/tasks")
      .send({ ...CREATE_BODY, assigneeId: 999 });

    expect(assignee.status).toBe(400);
    expect(assignee.body).toEqual({
      error: "Missing fields. Failed to create task.",
      errors: { assigneeId: ["That assignee no longer exists."] },
    });
  });

  it("inserts nothing for a refused body", async () => {
    const before = await request(createApp()).get("/api/tasks/count");

    await request(createApp())
      .post("/api/tasks")
      .send({ ...CREATE_BODY, projectId: 999 });

    const after = await request(createApp()).get("/api/tasks/count");

    expect(after.body.count).toBe(before.body.count);
  });
});

describe("PATCH /api/tasks/:id", () => {
  it("updates the task, advances updated_at, and redirects to it", async () => {
    const before = await request(createApp()).get("/api/tasks/102");

    const response = await request(createApp()).patch("/api/tasks/102").send({
      title: "Confirm breakpoint rules (revised)",
      description: "Agree the breakpoints, including the tablet one.",
      status: "in progress",
      assigneeId: 1,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      message: "Task updated.",
      redirectTo: "/tasks/102",
    });

    const after = await request(createApp()).get("/api/tasks/102");

    expect(after.body).toMatchObject({
      id: 102,
      title: "Confirm breakpoint rules (revised)",
      description: "Agree the breakpoints, including the tablet one.",
      status: "in progress",
      assigneeName: "Robin Andrew",
    });

    // spec/queries.md: the statement must explicitly advance updated_at.
    expect(after.body.updatedAt).not.toBe(before.body.updatedAt);
    expect(after.body.updatedAt > "2026-09-28T11:20:00Z").toBe(true);
  });

  it("unassigns the task when assigneeId is null", async () => {
    const response = await request(createApp()).patch("/api/tasks/102").send({
      title: "Confirm breakpoint rules",
      description:
        "Agree the breakpoints the shared layout tokens are generated from.",
      status: "todo",
      assigneeId: null,
    });

    expect(response.status).toBe(200);

    const after = await request(createApp()).get("/api/tasks/102");

    expect(after.body.assigneeName).toBe("Unassigned");
  });

  it("reports the reference's field errors for an invalid body", async () => {
    const response = await request(createApp())
      .patch("/api/tasks/102")
      .send({ description: "d", status: "later" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to update task.",
      errors: {
        title: ["Invalid input: expected string, received null"],
        status: ["Choose a valid status."],
      },
    });
  });

  it("reports the reference's assignee existence error", async () => {
    const response = await request(createApp()).patch("/api/tasks/102").send({
      title: "Confirm breakpoint rules",
      description:
        "Agree the breakpoints the shared layout tokens are generated from.",
      status: "todo",
      assigneeId: 999,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to update task.",
      errors: { assigneeId: ["That assignee no longer exists."] },
    });
  });

  it("returns the reference's 404 message for an unknown task", async () => {
    const response = await request(createApp()).patch("/api/tasks/999").send({
      title: "No such task",
      description: "",
      status: "todo",
      assigneeId: null,
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "That task no longer exists." });
  });
});

describe("DELETE /api/tasks/:id", () => {
  async function createTask(title: string) {
    const created = await request(createApp()).post("/api/tasks").send({
      projectId: 1,
      assigneeId: null,
      title,
      description: "A task the delete tests own.",
      status: "todo",
    });

    return Number(created.body.redirectTo.split("/")[2]);
  }

  it("deletes the task and redirects to its project board", async () => {
    const id = await createTask("Delete me");

    const response = await request(createApp()).delete(`/api/tasks/${id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      message: "Task deleted.",
      redirectTo: "/projects/1",
    });

    // The committed absence: not in the list, not-found on direct navigation.
    const detail = await request(createApp()).get(`/api/tasks/${id}`);

    expect(detail.status).toBe(404);
    expect(detail.body).toEqual({ error: "Not found" });
  });

  it("cascades the task's comments away with it", async () => {
    const id = await createTask("Delete me with my comments");

    await request(createApp())
      .post(`/api/tasks/${id}/comments`)
      .send({ body: "A comment that must not outlive its task.", authorId: 1 });

    await request(createApp()).delete(`/api/tasks/${id}`);

    const comments = await request(createApp()).get(
      `/api/tasks/${id}/comments`,
    );

    // Mirror getComments: a query scoped to a task that no longer exists
    // returns its (empty) comment list, not an error.
    expect(comments.status).toBe(200);
    expect(comments.body).toEqual([]);
  });

  it("returns the reference's 404 message for an unknown task", async () => {
    const response = await request(createApp()).delete("/api/tasks/999");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "That task no longer exists." });
  });
});

describe("POST /api/tasks/with-comment", () => {
  const BODY = {
    projectId: 1,
    assigneeId: 1,
    title: "Publish the navigation copy",
    description: "Ship the agreed labels.",
    status: "todo",
    commentBody: "Copy is finalised and ready to publish.",
    commentAuthorId: 2,
  };

  it("creates the task and its first comment in one transaction", async () => {
    const response = await request(createApp())
      .post("/api/tasks/with-comment")
      .send(BODY);

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    expect(response.body.redirectTo).toMatch(/^\/tasks\/\d+$/);

    const id = Number(response.body.redirectTo.split("/")[2]);

    // Both halves of the transaction are visible: the task row, and the one
    // comment it was created with.
    const detail = await request(createApp()).get(`/api/tasks/${id}`);
    const comments = await request(createApp()).get(
      `/api/tasks/${id}/comments`,
    );

    expect(detail.body).toMatchObject({ id, commentCount: 1 });
    expect(comments.body).toHaveLength(1);
    expect(comments.body[0]).toMatchObject({
      taskId: id,
      authorName: "Alex Morgan",
      body: "Copy is finalised and ready to publish.",
    });
  });

  it("reports the comment's own field errors with the task's message", async () => {
    const response = await request(createApp())
      .post("/api/tasks/with-comment")
      .send({ ...BODY, commentBody: "" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to create the task.",
      errors: { commentBody: ["Comment is required."] },
    });
  });

  it("reports the reference's author error, filed where the reference files it", async () => {
    const response = await request(createApp())
      .post("/api/tasks/with-comment")
      .send({ ...BODY, commentAuthorId: 999 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to create the task.",
      errors: { assigneeId: ["That comment author no longer exists."] },
    });
  });

  it("rolls back the task when the comment insert fails", async () => {
    // The HTTP layer pre-validates everything the schema constrains, so a
    // mid-transaction failure has to be provoked at the model layer — the same
    // rollback path the transaction provides to the endpoint. A body over the
    // CHECK on comments.body passes the endpoint's own checks only when the
    // model is called directly, and the task insert must not survive it.
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
    const search = await request(createApp()).get(
      "/api/tasks?q=Must not survive a failed comment",
    );

    expect(search.body).toEqual([]);
  });
});

describe("POST /api/tasks/:id/comments", () => {
  it("adds the comment and replies ok with no redirect, like the reference", async () => {
    const response = await request(createApp())
      .post("/api/tasks/101/comments")
      .send({ body: "A new comment from the integration suite.", authorId: 3 });

    // The reference's createComment returns no redirectTo — the user stays on
    // the detail page — so the reply is the ok marker alone.
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true });

    const comments = await request(createApp()).get("/api/tasks/101/comments");

    // Newest first: the fresh comment leads the list.
    expect(comments.body).toHaveLength(3);
    expect(comments.body[0]).toMatchObject({
      taskId: 101,
      authorName: "Sam Taylor",
      body: "A new comment from the integration suite.",
    });
  });

  it("never returns more than the 10 most recent comments", async () => {
    const created = await request(createApp()).post("/api/tasks").send({
      projectId: 2,
      assigneeId: null,
      title: "Comment volume probe",
      description: "",
      status: "todo",
    });
    const id = Number(created.body.redirectTo.split("/")[2]);

    // Eleven comments: one more than the bound, so a limit honoured only by
    // luck would show all eleven.
    for (let index = 0; index < 11; index += 1) {
      await request(createApp())
        .post(`/api/tasks/${id}/comments`)
        .send({ body: `Comment number ${index}.`, authorId: 1 });
    }

    const comments = await request(createApp()).get(
      `/api/tasks/${id}/comments`,
    );

    expect(comments.body).toHaveLength(10);
    expect(comments.body[0].body).toBe("Comment number 10.");
    expect(comments.body[9].body).toBe("Comment number 1.");
  });

  it("reports the reference's field errors for an empty body", async () => {
    const response = await request(createApp())
      .post("/api/tasks/101/comments")
      .send({ body: "", authorId: 1 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to add the comment.",
      errors: { body: ["Comment is required."] },
    });
  });

  it("reports the reference's author error", async () => {
    const response = await request(createApp())
      .post("/api/tasks/101/comments")
      .send({ body: "A comment.", authorId: 999 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing fields. Failed to add the comment.",
      errors: { authorId: ["That comment author no longer exists."] },
    });
  });

  it("returns the reference's 404 message for an unknown task", async () => {
    const response = await request(createApp())
      .post("/api/tasks/999/comments")
      .send({ body: "A comment.", authorId: 1 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "That task no longer exists." });
  });
});
