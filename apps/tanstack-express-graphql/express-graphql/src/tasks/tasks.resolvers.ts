// src/tasks/tasks.resolvers.ts
//
// The resolver layer for tasks: what the REST variant split between a
// controller (validate → model call → write the response) and a router (URL →
// controller method) collapses into one map — operation → model call. The
// validation logic and every message string are ported verbatim from the
// controller the GraphQL surface replaces, so a client that rendered the REST
// API's validation errors renders these unchanged.
//
// The reads build the same string bag the REST query params were, via
// src/graphql/args.ts, so the pure validators (src/tasks/tasks.validator.ts)
// run their identical rules; the writes pass the mutation arguments straight
// through — the arguments are the form's field bag of strings, exactly as the
// REST body was, and the validators own every coercion rule.

import { requireIdArg, intArg, stringArg } from "../graphql/args.ts";
import {
  badInputError,
  notFoundError,
  validationError,
} from "../graphql/graphql-error.ts";
import type { TasksModel } from "./tasks.model.ts";
import {
  parseCommentBody,
  parseCreateTaskRefs,
  parseTaskFields,
  parseTaskListQuery,
  parseUpdateAssignee,
  parseWithCommentFields,
} from "./tasks.validator.ts";

/** The `tasks` operation's filter arguments. */
type TasksArgs = {
  q?: string | null;
  status?: string | null;
  projectId?: number | null;
  assigneeId?: number | null;
  cursor?: string | null;
  limit?: number | null;
};

/** The `taskCount` operation's arguments — the list's filters, no paging. */
type TaskCountArgs = Omit<TasksArgs, "cursor" | "limit">;

/** The task fields a `createTask`/`createTaskWithComment` mutation submits. */
type TaskFieldsArgs = {
  title?: string | null;
  description?: string | null;
  status?: string | null;
};

type CreateTaskArgs = TaskFieldsArgs & {
  projectId?: string | null;
  assigneeId?: string | null;
};

type CreateTaskWithCommentArgs = CreateTaskArgs & {
  commentBody?: string | null;
  commentAuthorId?: string | null;
};

type UpdateTaskArgs = TaskFieldsArgs & {
  assigneeId?: string | null;
};

type AddTaskCommentArgs = {
  body?: string | null;
  authorId?: string | null;
};

export function createTasksResolvers(model: TasksModel) {
  return {
    Query: {
      /** The workspace-wide task list, one keyset page. */
      async tasks(_parent: unknown, args: TasksArgs) {
        const parsed = parseTaskListQuery({
          q: stringArg(args.q),
          status: stringArg(args.status),
          projectId: intArg(args.projectId),
          assigneeId: intArg(args.assigneeId),
          cursor: stringArg(args.cursor),
          limit: intArg(args.limit),
        });

        if (!parsed.ok) {
          throw badInputError(parsed.error);
        }

        return model.list(parsed.filters);
      },

      /** How many tasks match the list's filters. */
      async taskCount(_parent: unknown, args: TaskCountArgs) {
        // The count shares the list's filters; cursor/limit are list-paging
        // params and are simply not part of a count, so GraphQL leaves them
        // out of the operation's arguments rather than the resolver ignoring
        // them.
        const parsed = parseTaskListQuery({
          q: stringArg(args.q),
          status: stringArg(args.status),
          projectId: intArg(args.projectId),
          assigneeId: intArg(args.assigneeId),
        });

        if (!parsed.ok) {
          throw badInputError(parsed.error);
        }

        return model.count(parsed.filters);
      },

      /** One task with its project and assignee names. */
      async task(_parent: unknown, args: { id: number }) {
        const id = requireIdArg(args.id);
        const task = await model.get(id);

        if (!task) {
          throw notFoundError("Not found");
        }

        return task;
      },

      /** The 10 most recent comments on one task. */
      async taskComments(_parent: unknown, args: { taskId: number }) {
        const taskId = requireIdArg(args.taskId);

        return model.listComments(taskId);
      },
    },

    Mutation: {
      /** Insert one task; the SPA navigates to its detail page next. */
      async createTask(_parent: unknown, args: CreateTaskArgs) {
        const fields = parseTaskFields(args);

        if (!fields.ok) {
          throw validationError(
            "Missing fields. Failed to create task.",
            fields.errors,
          );
        }

        const refs = parseCreateTaskRefs({
          projectId: args.projectId,
          assigneeId: args.assigneeId,
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
      },

      /** One transaction: a task and its first comment. */
      async createTaskWithComment(
        _parent: unknown,
        args: CreateTaskWithCommentArgs,
      ) {
        // The comment has its own bound (char_length BETWEEN 1 AND 1000),
        // enforced by its own schema so the message lands on the comment field.
        const fields = parseTaskFields(args);

        if (!fields.ok) {
          throw validationError(
            "Missing fields. Failed to create the task.",
            fields.errors,
          );
        }

        const comment = parseWithCommentFields(args);

        if (!comment.ok) {
          throw validationError(
            "Missing fields. Failed to create the task.",
            comment.errors,
          );
        }

        const refs = parseCreateTaskRefs({
          projectId: args.projectId,
          assigneeId: args.assigneeId,
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
      },

      /** Update one task by primary key. */
      async updateTask(_parent: unknown, args: UpdateTaskArgs & { id: number }) {
        const id = requireIdArg(args.id);

        const fields = parseTaskFields(args);

        if (!fields.ok) {
          throw validationError(
            "Missing fields. Failed to update task.",
            fields.errors,
          );
        }

        // The project is deliberately not updatable here: spec/contract.md lists
        // the update form's fields as title, status, assignee and description —
        // a task belongs to its project for its lifetime.
        const assignee = parseUpdateAssignee({ assigneeId: args.assigneeId });

        if (!assignee.ok) {
          throw validationError("Missing fields. Failed to update task.", assignee.errors);
        }

        const result = await model.update(id, {
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
          redirectTo: `/tasks/${id}`,
        };
      },

      /** Delete one task; its comments cascade with it. */
      async deleteTask(_parent: unknown, args: { id: number }) {
        const id = requireIdArg(args.id);
        const removed = await model.remove(id);

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
      },

      /** Add one comment to an existing task. */
      async addTaskComment(
        _parent: unknown,
        args: AddTaskCommentArgs & { taskId: number },
      ) {
        const taskId = requireIdArg(args.taskId);
        const parsed = parseCommentBody(args);

        if (!parsed.ok) {
          throw validationError(
            "Missing fields. Failed to add the comment.",
            parsed.errors,
          );
        }

        const result = await model.addComment(taskId, parsed.data);

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
      },
    },
  };
}
