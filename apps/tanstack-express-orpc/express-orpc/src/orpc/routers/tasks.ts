// src/orpc/routers/tasks.ts
//
// The tasks domain: handlers that pass straight through to the model layer.
//
// The counterpart to the REST variant's tasks.controller.ts. See that file
// and src/orpc/contract.ts for the shape rules doing real work; the
// behavioural contract is unchanged:
//
//   * The SQL, the validation and the `try`/`catch` all live in the model
//     (src/tasks/tasks.model.ts), the only module that talks to Postgres.
//   * Value validation is not here. A blank title is user error the form
//     renders, so the pure validators own it and their messages are the
//     reference variant's zod schemas verbatim.
//   * `update` accepts no `projectId`: spec/contract.md lists the update
//     form's fields as title, status, assignee and description only, and the
//     contract enforces it.
//   * `assigneeId` arrives as the form submitted it ("" or null mean
//     unassigned) — the server owns the one normalisation rule, so the client
//     cannot disagree with itself about how a value is spelled.
//
// The list's integer parsing (`projectId must be an integer`, …) is gone: the
// contract's `.input()` now owns the SHAPE check, which is a client bug rather
// than user error. The value rules that produce user-visible messages (an
// unknown status, an over-long search term) stay here.

import { implement } from "@orpc/server";

import { parseSearchTerm } from "../../lib/query.validator.ts";
import type { TasksModel } from "../../tasks/tasks.model.ts";
import {
  parseCommentBody,
  parseCreateTaskRefs,
  parseTaskFields,
  parseTaskStatus,
  parseUpdateAssignee,
  parseWithCommentFields,
  type TaskListFilters,
} from "../../tasks/tasks.validator.ts";
import { tasksContract } from "../contract.ts";
import { notFoundError, validationError } from "../errors.ts";

const os = implement(tasksContract);

/** The `q` + `status` value rules, in the order the REST layer checked them. */
function parseListValues(input: {
  q?: string | null;
  status?: string | null;
}): { search: string; status: string } {
  const q = parseSearchTerm(input.q);

  if (!q.ok) {
    throw validationError(q.error);
  }

  const status = parseTaskStatus(input.status);

  if (!status.ok) {
    throw validationError(status.error);
  }

  return { search: q.term, status: status.status };
}

export function createTasksRouter(model: TasksModel) {
  return os.router({
    list: os.list.handler(async ({ input }) => {
      const values = parseListValues(input);

      const filters: TaskListFilters = {
        search: values.search,
        status: values.status,
        projectId: input.projectId ?? undefined,
        assigneeId: input.assigneeId ?? undefined,
        cursor: input.cursor ?? null,
        limit: input.limit ?? undefined,
      };

      return model.list(filters);
    }),

    count: os.count.handler(async ({ input }) => {
      const values = parseListValues(input);

      return model.count({
        search: values.search,
        status: values.status,
        projectId: input.projectId ?? undefined,
        assigneeId: input.assigneeId ?? undefined,
        cursor: null,
        limit: undefined,
      });
    }),

    byId: os.byId.handler(async ({ input }) => {
      const task = await model.get(input.id);

      if (!task) {
        throw notFoundError("Not found");
      }

      return task;
    }),

    comments: os.comments.handler(({ input }) => model.listComments(input.id)),

    create: os.create.handler(async ({ input }) => {
      const fields = parseTaskFields(input);

      if (!fields.ok) {
        throw validationError(
          "Missing fields. Failed to create task.",
          fields.errors,
        );
      }

      const refs = parseCreateTaskRefs({
        projectId: input.projectId,
        assigneeId: input.assigneeId,
      });

      if (!refs.ok) {
        throw validationError(
          "Missing fields. Failed to create task.",
          refs.errors,
        );
      }

      // Only once the shape of the fields is known to be good does it make
      // sense to ask the database whether the referenced rows exist.
      const resolved = await model.resolveRefs(refs.projectId, refs.assigneeId);

      if (Object.keys(resolved.errors).length > 0) {
        throw validationError(
          "Missing fields. Failed to create task.",
          resolved.errors,
        );
      }

      const created = await model.create({
        projectId: refs.projectId,
        assigneeId: refs.assigneeId,
        ...fields.data,
      });

      return {
        ok: true as const,
        message: "Task created.",
        redirectTo: `/tasks/${created.id}`,
      };
    }),

    createWithComment: os.createWithComment.handler(async ({ input }) => {
      // The comment has its own bound (char_length BETWEEN 1 AND 1000),
      // enforced by its own schema so the message lands on the comment field.
      const fields = parseTaskFields(input);

      if (!fields.ok) {
        throw validationError(
          "Missing fields. Failed to create the task.",
          fields.errors,
        );
      }

      const comment = parseWithCommentFields(input);

      if (!comment.ok) {
        throw validationError(
          "Missing fields. Failed to create the task.",
          comment.errors,
        );
      }

      const refs = parseCreateTaskRefs({
        projectId: input.projectId,
        assigneeId: input.assigneeId,
      });

      if (!refs.ok) {
        throw validationError(
          "Missing fields. Failed to create the task.",
          refs.errors,
        );
      }

      const resolved = await model.resolveRefs(refs.projectId, refs.assigneeId);

      if (Object.keys(resolved.errors).length > 0) {
        throw validationError(
          "Missing fields. Failed to create the task.",
          resolved.errors,
        );
      }

      const created = await model.createWithComment({
        projectId: refs.projectId,
        assigneeId: refs.assigneeId,
        ...fields.data,
        commentBody: comment.data.commentBody,
        commentAuthorId: comment.data.commentAuthorId,
      });

      if (created.status === "author-missing") {
        // Filed under assigneeId verbatim from the reference: its form has one
        // person select, so a bad author landed on the same field the assignee
        // errors land on. The message string is the contract; the key follows
        // it so a client renders both identically.
        throw validationError("Missing fields. Failed to create the task.", {
          assigneeId: ["That comment author no longer exists."],
        });
      }

      return {
        ok: true as const,
        message: "Task created.",
        redirectTo: `/tasks/${created.id}`,
      };
    }),

    update: os.update.handler(async ({ input }) => {
      const fields = parseTaskFields(input);

      if (!fields.ok) {
        throw validationError(
          "Missing fields. Failed to update task.",
          fields.errors,
        );
      }

      const assignee = parseUpdateAssignee({ assigneeId: input.assigneeId });

      if (!assignee.ok) {
        throw validationError(
          "Missing fields. Failed to update task.",
          assignee.errors,
        );
      }

      const result = await model.update(input.id, {
        ...fields.data,
        assigneeId: assignee.assigneeId,
      });

      if (result.status === "assignee-missing") {
        throw validationError("Missing fields. Failed to update task.", {
          assigneeId: ["That assignee no longer exists."],
        });
      }

      if (result.status === "missing") {
        throw notFoundError("That task no longer exists.");
      }

      return {
        ok: true as const,
        message: "Task updated.",
        redirectTo: `/tasks/${input.id}`,
      };
    }),

    remove: os.remove.handler(async ({ input }) => {
      const removed = await model.remove(input.id);

      if (!removed) {
        throw notFoundError("That task no longer exists.");
      }

      // Straight to the board: the detail page for this id is now not-found,
      // so redirecting there would land the user on a dead URL.
      return {
        ok: true as const,
        message: "Task deleted.",
        redirectTo: `/projects/${removed.projectId}`,
      };
    }),

    addComment: os.addComment.handler(async ({ input }) => {
      const parsed = parseCommentBody(input);

      if (!parsed.ok) {
        throw validationError(
          "Missing fields. Failed to add the comment.",
          parsed.errors,
        );
      }

      const result = await model.addComment(input.id, parsed.data);

      if (result.status === "task-missing") {
        throw notFoundError("That task no longer exists.");
      }

      if (result.status === "author-missing") {
        throw validationError("Missing fields. Failed to add the comment.", {
          authorId: ["That comment author no longer exists."],
        });
      }

      // No redirect, mirroring the reference's createComment return exactly:
      // the user stays on the task detail page and sees the comment they just
      // wrote in the list above the form, so there is no `redirectTo` (and no
      // message) to return — `ok: true` is the whole reply.
      return { ok: true as const };
    }),
  });
}

export type TasksRouter = ReturnType<typeof createTasksRouter>;
