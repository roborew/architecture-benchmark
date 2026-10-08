// tests/integration/tasks.writes.integration.test.ts
//
// The write surface behind the task forms: the createTask / updateTask /
// deleteTask mutations, the transactional createTaskWithComment, and
// addTaskComment. Exercises the full stack (POST /graphql → resolvers →
// models → Postgres) through supertest against the seeded test database, and
// asserts the exact envelopes the reference variant's actions produce
// (message strings verbatim, field errors keyed by argument name, FK guards)
// plus the committed state a mutation must leave behind.
//
// Every mutation resolves with the old REST envelope verbatim as its data
// (`{ ok, message, redirectTo }` — addTaskComment replies `{ ok }` alone), and
// every refusal is HTTP 200 with the old 400/404/409 outcome inside `errors`:
// the message string plus `extensions.code` / `extensions.errors`.
//
// The mutation arguments are the form's field bag of strings — the schema
// types them String, so an id travels as "1" and the validators own every
// coercion rule, exactly as they owned it over REST bodies.
//
// The writes run after the reads in this file, and the file is self-contained:
// the suite's setup re-seeds the database per file, so the reads above always
// start from the fixture.

import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "../../src/app.ts";
import { createConnection } from "../../src/db/connection.ts";
import { createTasksModel } from "../../src/tasks/tasks.model.ts";
import { e2eConnectionString } from "../helpers/database.ts";

function gql(
  app: Express,
  query: string,
  variables: Record<string, unknown> = {},
) {
  return request(app).post("/graphql").send({ query, variables });
}

const CREATE_TASK_MUTATION = `
  mutation CreateTask(
    $projectId: String
    $assigneeId: String
    $title: String
    $description: String
    $status: String
  ) {
    createTask(
      projectId: $projectId
      assigneeId: $assigneeId
      title: $title
      description: $description
      status: $status
    ) {
      ok
      message
      redirectTo
    }
  }
`;

const CREATE_TASK_WITH_COMMENT_MUTATION = `
  mutation CreateTaskWithComment(
    $projectId: String
    $assigneeId: String
    $title: String
    $description: String
    $status: String
    $commentBody: String
    $commentAuthorId: String
  ) {
    createTaskWithComment(
      projectId: $projectId
      assigneeId: $assigneeId
      title: $title
      description: $description
      status: $status
      commentBody: $commentBody
      commentAuthorId: $commentAuthorId
    ) {
      ok
      message
      redirectTo
    }
  }
`;

const UPDATE_TASK_MUTATION = `
  mutation UpdateTask(
    $id: Int!
    $title: String
    $description: String
    $status: String
    $assigneeId: String
  ) {
    updateTask(
      id: $id
      title: $title
      description: $description
      status: $status
      assigneeId: $assigneeId
    ) {
      ok
      message
      redirectTo
    }
  }
`;

const DELETE_TASK_MUTATION = `
  mutation DeleteTask($id: Int!) {
    deleteTask(id: $id) {
      ok
      message
      redirectTo
    }
  }
`;

const ADD_TASK_COMMENT_MUTATION = `
  mutation AddTaskComment($taskId: Int!, $body: String, $authorId: String) {
    addTaskComment(taskId: $taskId, body: $body, authorId: $authorId) {
      ok
    }
  }
`;

// The read documents the writes verify their committed state through.
const TASK_QUERY = `
  query Task($id: Int!) {
    task(id: $id) {
      id
      projectId
      projectName
      title
      description
      status
      assigneeName
      commentCount
      updatedAt
    }
  }
`;

const TASKS_QUERY = `
  query Tasks($q: String) {
    tasks(q: $q) {
      id
    }
  }
`;

const TASK_COUNT_QUERY = "query TaskCount { taskCount }";

const TASK_COMMENTS_QUERY = `
  query TaskComments($taskId: Int!) {
    taskComments(taskId: $taskId) {
      id
      taskId
      authorName
      body
      createdAt
    }
  }
`;

// The board is where a task's createdAtRaw (the cursor component) is exposed,
// which the created_at/updated_at agreement probe reads.
const BOARD_QUERY = `
  query ProjectTasks($projectId: Int!) {
    projectTasks(projectId: $projectId) {
      id
      updatedAt
      createdAtRaw
    }
  }
`;

// The form's field bag, exactly as the SPA submits it: every value a string
// (or the explicit null that means "unassigned").
const CREATE_BODY = {
  projectId: "1",
  assigneeId: "2",
  title: "Audit the navigation copy",
  description: "Re-read every navigation label against the new IA.",
  status: "todo",
};

describe("mutation createTask", () => {
  it("creates the task and points the client at its detail page", async () => {
    const response = await gql(createApp(), CREATE_TASK_MUTATION, CREATE_BODY);

    // The old 201 + JSON envelope is now a 200 whose data IS the envelope.
    expect(response.status).toBe(200);
    expect(response.body.data.createTask.ok).toBe(true);
    expect(response.body.data.createTask.message).toBe("Task created.");
    expect(response.body.data.createTask.redirectTo).toMatch(/^\/tasks\/\d+$/);

    // A persisted id must have been allocated (spec/contract.md): the redirect
    // target resolves to the committed row.
    const id = Number(response.body.data.createTask.redirectTo.split("/")[2]);
    const detail = await gql(createApp(), TASK_QUERY, { id });

    expect(detail.status).toBe(200);
    expect(detail.body.data.task).toMatchObject({
      id,
      projectId: 1,
      title: "Audit the navigation copy",
      status: "todo",
      assigneeName: "Alex Morgan",
    });
  });

  it("sets created_at and updated_at equal at insert", async () => {
    const created = await gql(createApp(), CREATE_TASK_MUTATION, {
      ...CREATE_BODY,
      title: "Timestamp probe",
    });
    const id = Number(created.body.data.createTask.redirectTo.split("/")[2]);

    // created_at is only exposed on the board's rows (createdAtRaw, the
    // cursor component) and updated_at on every row: the two must agree to the
    // second, which is the fixture's precision and the display contract.
    const board = await gql(createApp(), BOARD_QUERY, { projectId: 1 });
    const row = board.body.data.projectTasks.find(
      (task: { id: number }) => task.id === id,
    );

    expect(row.createdAtRaw.slice(0, 19)).toBe(row.updatedAt.slice(0, 19));
  });

  it("creates an unassigned task when assigneeId is null", async () => {
    const response = await gql(createApp(), CREATE_TASK_MUTATION, {
      ...CREATE_BODY,
      assigneeId: null,
    });

    const id = Number(response.body.data.createTask.redirectTo.split("/")[2]);
    const detail = await gql(createApp(), TASK_QUERY, { id });

    expect(detail.body.data.task.assigneeName).toBe("Unassigned");
  });

  it("reports the reference's field errors for an invalid body", async () => {
    const response = await gql(createApp(), CREATE_TASK_MUTATION, {
      ...CREATE_BODY,
      title: "",
      status: "bogus",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create task.",
      extensions: {
        code: "BAD_INPUT",
        errors: {
          title: ["Title is required."],
          status: ["Choose a valid status."],
        },
      },
    });
  });

  it("reports an omitted title exactly as the reference's form does", async () => {
    // The title variable is simply not sent — the form field was absent, which
    // the validator reads back as null, exactly as the REST body's omission.
    const response = await gql(createApp(), CREATE_TASK_MUTATION, {
      projectId: "1",
      status: "todo",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { title: ["Invalid input: expected string, received null"] },
      },
    });
  });

  it("reports the reference's choose-a-project error for a bad project id", async () => {
    const response = await gql(createApp(), CREATE_TASK_MUTATION, {
      ...CREATE_BODY,
      projectId: "one",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { projectId: ["Choose a project."] },
      },
    });
  });

  it("reports the reference's existence errors for unknown project or assignee", async () => {
    const project = await gql(createApp(), CREATE_TASK_MUTATION, {
      ...CREATE_BODY,
      projectId: "999",
    });

    expect(project.body.data).toBeNull();
    expect(project.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { projectId: ["That project no longer exists."] },
      },
    });

    const assignee = await gql(createApp(), CREATE_TASK_MUTATION, {
      ...CREATE_BODY,
      assigneeId: "999",
    });

    expect(assignee.body.data).toBeNull();
    expect(assignee.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { assigneeId: ["That assignee no longer exists."] },
      },
    });
  });

  it("inserts nothing for a refused body", async () => {
    const before = await gql(createApp(), TASK_COUNT_QUERY);

    await gql(createApp(), CREATE_TASK_MUTATION, {
      ...CREATE_BODY,
      projectId: "999",
    });

    const after = await gql(createApp(), TASK_COUNT_QUERY);

    expect(after.body.data.taskCount).toBe(before.body.data.taskCount);
  });
});

describe("mutation updateTask", () => {
  it("updates the task, advances updated_at, and points back at it", async () => {
    const before = await gql(createApp(), TASK_QUERY, { id: 102 });

    const response = await gql(createApp(), UPDATE_TASK_MUTATION, {
      id: 102,
      title: "Confirm breakpoint rules (revised)",
      description: "Agree the breakpoints, including the tablet one.",
      status: "in progress",
      assigneeId: "1",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.updateTask).toEqual({
      ok: true,
      message: "Task updated.",
      redirectTo: "/tasks/102",
    });

    const after = await gql(createApp(), TASK_QUERY, { id: 102 });

    expect(after.body.data.task).toMatchObject({
      id: 102,
      title: "Confirm breakpoint rules (revised)",
      description: "Agree the breakpoints, including the tablet one.",
      status: "in progress",
      assigneeName: "Robin Andrew",
    });

    // spec/queries.md: the statement must explicitly advance updated_at.
    expect(after.body.data.task.updatedAt).not.toBe(
      before.body.data.task.updatedAt,
    );
    expect(after.body.data.task.updatedAt > "2026-09-28T11:20:00Z").toBe(true);
  });

  it("unassigns the task when assigneeId is null", async () => {
    const response = await gql(createApp(), UPDATE_TASK_MUTATION, {
      id: 102,
      title: "Confirm breakpoint rules",
      description:
        "Agree the breakpoints the shared layout tokens are generated from.",
      status: "todo",
      assigneeId: null,
    });

    expect(response.status).toBe(200);

    const after = await gql(createApp(), TASK_QUERY, { id: 102 });

    expect(after.body.data.task.assigneeName).toBe("Unassigned");
  });

  it("reports the reference's field errors for an invalid body", async () => {
    // The title variable is omitted and the status is not one of the stored
    // values — both field errors land together, keyed by argument name.
    const response = await gql(createApp(), UPDATE_TASK_MUTATION, {
      id: 102,
      description: "d",
      status: "later",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to update task.",
      extensions: {
        code: "BAD_INPUT",
        errors: {
          title: ["Invalid input: expected string, received null"],
          status: ["Choose a valid status."],
        },
      },
    });
  });

  it("reports the reference's assignee existence error", async () => {
    const response = await gql(createApp(), UPDATE_TASK_MUTATION, {
      id: 102,
      title: "Confirm breakpoint rules",
      description:
        "Agree the breakpoints the shared layout tokens are generated from.",
      status: "todo",
      assigneeId: "999",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to update task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { assigneeId: ["That assignee no longer exists."] },
      },
    });
  });

  it("answers NOT_FOUND with the reference's message for an unknown task", async () => {
    const response = await gql(createApp(), UPDATE_TASK_MUTATION, {
      id: 999,
      title: "No such task",
      description: "",
      status: "todo",
      assigneeId: null,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "That task no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });
});

describe("mutation deleteTask", () => {
  // A task these tests own, created through the mutation and deleted through
  // it — never one of the seeded fixture's rows.
  async function createTask(title: string) {
    const created = await gql(createApp(), CREATE_TASK_MUTATION, {
      projectId: "1",
      assigneeId: null,
      title,
      description: "A task the delete tests own.",
      status: "todo",
    });

    return Number(created.body.data.createTask.redirectTo.split("/")[2]);
  }

  it("deletes the task and points the client at its project board", async () => {
    const id = await createTask("Delete me");

    const response = await gql(createApp(), DELETE_TASK_MUTATION, { id });

    expect(response.status).toBe(200);
    expect(response.body.data.deleteTask).toEqual({
      ok: true,
      message: "Task deleted.",
      redirectTo: "/projects/1",
    });

    // The committed absence: the task read is now the not-found error.
    const detail = await gql(createApp(), TASK_QUERY, { id });

    expect(detail.body.data).toBeNull();
    expect(detail.body.errors[0]).toMatchObject({
      message: "Not found",
      extensions: { code: "NOT_FOUND" },
    });
  });

  it("cascades the task's comments away with it", async () => {
    const id = await createTask("Delete me with my comments");

    await gql(createApp(), ADD_TASK_COMMENT_MUTATION, {
      taskId: id,
      body: "A comment that must not outlive its task.",
      authorId: "1",
    });

    await gql(createApp(), DELETE_TASK_MUTATION, { id });

    const comments = await gql(createApp(), TASK_COMMENTS_QUERY, {
      taskId: id,
    });

    // Mirror the comments read: a query scoped to a task that no longer
    // exists returns its (empty) comment list, not an error.
    expect(comments.status).toBe(200);
    expect(comments.body.data.taskComments).toEqual([]);
  });

  it("answers NOT_FOUND with the reference's message for an unknown task", async () => {
    const response = await gql(createApp(), DELETE_TASK_MUTATION, {
      id: 999,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "That task no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });
});

describe("mutation createTaskWithComment", () => {
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
    const response = await gql(
      createApp(),
      CREATE_TASK_WITH_COMMENT_MUTATION,
      BODY,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.createTaskWithComment.ok).toBe(true);
    expect(response.body.data.createTaskWithComment.redirectTo).toMatch(
      /^\/tasks\/\d+$/,
    );

    const id = Number(
      response.body.data.createTaskWithComment.redirectTo.split("/")[2],
    );

    // Both halves of the transaction are visible: the task row, and the one
    // comment it was created with.
    const detail = await gql(createApp(), TASK_QUERY, { id });
    const comments = await gql(createApp(), TASK_COMMENTS_QUERY, {
      taskId: id,
    });

    expect(detail.body.data.task).toMatchObject({ id, commentCount: 1 });
    expect(comments.body.data.taskComments).toHaveLength(1);
    expect(comments.body.data.taskComments[0]).toMatchObject({
      taskId: id,
      authorName: "Alex Morgan",
      body: "Copy is finalised and ready to publish.",
    });
  });

  it("reports the comment's own field errors with the task's message", async () => {
    const response = await gql(createApp(), CREATE_TASK_WITH_COMMENT_MUTATION, {
      ...BODY,
      commentBody: "",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create the task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { commentBody: ["Comment is required."] },
      },
    });
  });

  it("reports the reference's author error, filed where the reference files it", async () => {
    const response = await gql(createApp(), CREATE_TASK_WITH_COMMENT_MUTATION, {
      ...BODY,
      commentAuthorId: "999",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to create the task.",
      extensions: {
        code: "BAD_INPUT",
        errors: { assigneeId: ["That comment author no longer exists."] },
      },
    });
  });

  it("rolls back the task when the comment insert fails", async () => {
    // The resolvers pre-validate everything the schema constrains, so a
    // mid-transaction failure has to be provoked at the model layer — the same
    // rollback path the transaction provides to the mutation. A body over the
    // CHECK on comments.body passes the resolvers' own checks only when the
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
    const search = await gql(createApp(), TASKS_QUERY, {
      q: "Must not survive a failed comment",
    });

    expect(search.body.data.tasks).toEqual([]);
  });
});

describe("mutation addTaskComment", () => {
  it("adds the comment and replies ok with no redirect, like the reference", async () => {
    const response = await gql(createApp(), ADD_TASK_COMMENT_MUTATION, {
      taskId: 101,
      body: "A new comment from the integration suite.",
      authorId: "3",
    });

    // The reference's createComment returns no redirectTo — the user stays on
    // the detail page — so the reply is the ok marker alone.
    expect(response.status).toBe(200);
    expect(response.body.data.addTaskComment).toEqual({ ok: true });

    const comments = await gql(createApp(), TASK_COMMENTS_QUERY, {
      taskId: 101,
    });

    // Newest first: the fresh comment leads the list.
    expect(comments.body.data.taskComments).toHaveLength(3);
    expect(comments.body.data.taskComments[0]).toMatchObject({
      taskId: 101,
      authorName: "Sam Taylor",
      body: "A new comment from the integration suite.",
    });
  });

  it("never returns more than the 10 most recent comments", async () => {
    const created = await gql(createApp(), CREATE_TASK_MUTATION, {
      projectId: "2",
      assigneeId: null,
      title: "Comment volume probe",
      description: "",
      status: "todo",
    });
    const id = Number(created.body.data.createTask.redirectTo.split("/")[2]);

    // Eleven comments: one more than the bound, so a limit honoured only by
    // luck would show all eleven.
    for (let index = 0; index < 11; index += 1) {
      await gql(createApp(), ADD_TASK_COMMENT_MUTATION, {
        taskId: id,
        body: `Comment number ${index}.`,
        authorId: "1",
      });
    }

    const comments = await gql(createApp(), TASK_COMMENTS_QUERY, {
      taskId: id,
    });

    expect(comments.body.data.taskComments).toHaveLength(10);
    expect(comments.body.data.taskComments[0].body).toBe("Comment number 10.");
    expect(comments.body.data.taskComments[9].body).toBe("Comment number 1.");
  });

  it("reports the reference's field errors for an empty body", async () => {
    const response = await gql(createApp(), ADD_TASK_COMMENT_MUTATION, {
      taskId: 101,
      body: "",
      authorId: "1",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to add the comment.",
      extensions: {
        code: "BAD_INPUT",
        errors: { body: ["Comment is required."] },
      },
    });
  });

  it("reports the reference's author error", async () => {
    const response = await gql(createApp(), ADD_TASK_COMMENT_MUTATION, {
      taskId: 101,
      body: "A comment.",
      authorId: "999",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "Missing fields. Failed to add the comment.",
      extensions: {
        code: "BAD_INPUT",
        errors: { authorId: ["That comment author no longer exists."] },
      },
    });
  });

  it("answers NOT_FOUND with the reference's message for an unknown task", async () => {
    const response = await gql(createApp(), ADD_TASK_COMMENT_MUTATION, {
      taskId: 999,
      body: "A comment.",
      authorId: "1",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      message: "That task no longer exists.",
      extensions: { code: "NOT_FOUND" },
    });
  });
});
