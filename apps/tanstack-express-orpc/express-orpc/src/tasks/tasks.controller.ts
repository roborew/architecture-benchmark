// src/tasks/tasks.controller.ts
//
// The controller layer: validates the request, translates it into a model
// call, and writes the model's result to the response. It knows Express types
// and nothing about SQL; the model knows SQL and nothing about HTTP.
//
// Validation lives in src/tasks/tasks.validator.ts (pure) and the body-field
// errors it produces are the reference variant's message strings verbatim.
// Failures are thrown as HttpError and mapped to their JSON envelope by the
// error handler; successes are written here, including the `redirectTo` the
// reference's actions return, which is where the SPA navigates next.

import type { Request, Response } from "express";

import { HttpError } from "../lib/http-error.ts";
import { parseIdParam } from "../lib/query.validator.ts";
import type { TasksModel } from "./tasks.model.ts";
import {
  parseCommentBody,
  parseCreateTaskRefs,
  parseTaskFields,
  parseTaskListQuery,
  parseUpdateAssignee,
  parseWithCommentFields,
} from "./tasks.validator.ts";

export interface TasksController {
  /** GET /api/tasks — the workspace-wide task list, one keyset page. */
  list(req: Request, res: Response): Promise<void>;

  /** GET /api/tasks/count — how many tasks match the list's filters. */
  count(req: Request, res: Response): Promise<void>;

  /** GET /api/tasks/:id — one task with its project and assignee names. */
  get(req: Request, res: Response): Promise<void>;

  /** GET /api/tasks/:id/comments — the 10 most recent comments on one task. */
  listComments(req: Request, res: Response): Promise<void>;

  /** POST /api/tasks — insert one task, redirect to its detail page. */
  create(req: Request, res: Response): Promise<void>;

  /** POST /api/tasks/with-comment — one transaction: a task and its first comment. */
  createWithComment(req: Request, res: Response): Promise<void>;

  /** PATCH /api/tasks/:id — update one task by primary key. */
  update(req: Request, res: Response): Promise<void>;

  /** DELETE /api/tasks/:id — delete one task; its comments cascade with it. */
  remove(req: Request, res: Response): Promise<void>;

  /** POST /api/tasks/:id/comments — add one comment to an existing task. */
  addComment(req: Request, res: Response): Promise<void>;
}

/** The `:id` a detail/update/delete URL names, or a 400 envelope. */
function requireId(raw: unknown): number {
  const parsed = parseIdParam(raw);

  if (!parsed.ok) {
    throw new HttpError(400, { error: parsed.error });
  }

  return parsed.id;
}

export function createTasksController(model: TasksModel): TasksController {
  return {
    async list(req, res) {
      const parsed = parseTaskListQuery(req.query as Record<string, unknown>);

      if (!parsed.ok) {
        throw new HttpError(400, { error: parsed.error });
      }

      const tasks = await model.list(parsed.filters);

      res.status(200).json(tasks);
    },

    async count(req, res) {
      // The count shares the list's filters; cursor/limit are list-paging
      // params and are simply not part of a count, so they are ignored here
      // rather than rejected.
      const parsed = parseTaskListQuery(req.query as Record<string, unknown>);

      if (!parsed.ok) {
        throw new HttpError(400, { error: parsed.error });
      }

      const count = await model.count(parsed.filters);

      res.status(200).json({ count });
    },

    async get(req, res) {
      const id = requireId(req.params.id);
      const task = await model.get(id);

      if (!task) {
        throw HttpError.notFound("Not found");
      }

      res.status(200).json(task);
    },

    async listComments(req, res) {
      const id = requireId(req.params.id);
      const comments = await model.listComments(id);

      res.status(200).json(comments);
    },

    async create(req, res) {
      const fields = parseTaskFields(req.body);

      if (!fields.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to create task.",
          fields.errors,
        );
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const refs = parseCreateTaskRefs({
        projectId: body.projectId,
        assigneeId: body.assigneeId,
      });

      if (!refs.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to create task.",
          refs.errors,
        );
      }

      // Only once the shape of the fields is known to be good does it make
      // sense to ask the database whether the referenced rows exist.
      const resolved = await model.resolveRefs(refs.projectId, refs.assigneeId);

      if (Object.keys(resolved.errors).length > 0) {
        throw HttpError.validation(
          "Missing fields. Failed to create task.",
          resolved.errors,
        );
      }

      const created = await model.create({
        projectId: refs.projectId,
        assigneeId: refs.assigneeId,
        ...fields.data,
      });

      res.status(201).json({
        ok: true,
        message: "Task created.",
        redirectTo: `/tasks/${created.id}`,
      });
    },

    async createWithComment(req, res) {
      // The comment has its own bound (char_length BETWEEN 1 AND 1000),
      // enforced by its own schema so the message lands on the comment field.
      const fields = parseTaskFields(req.body);

      if (!fields.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to create the task.",
          fields.errors,
        );
      }

      const comment = parseWithCommentFields(req.body);

      if (!comment.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to create the task.",
          comment.errors,
        );
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const refs = parseCreateTaskRefs({
        projectId: body.projectId,
        assigneeId: body.assigneeId,
      });

      if (!refs.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to create the task.",
          refs.errors,
        );
      }

      const resolved = await model.resolveRefs(refs.projectId, refs.assigneeId);

      if (Object.keys(resolved.errors).length > 0) {
        throw HttpError.validation(
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
        throw HttpError.validation(
          "Missing fields. Failed to create the task.",
          {
            assigneeId: ["That comment author no longer exists."],
          },
        );
      }

      res.status(201).json({
        ok: true,
        message: "Task created.",
        redirectTo: `/tasks/${created.id}`,
      });
    },

    async update(req, res) {
      const id = requireId(req.params.id);

      const fields = parseTaskFields(req.body);

      if (!fields.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to update task.",
          fields.errors,
        );
      }

      // The project is deliberately not updatable here: spec/contract.md lists
      // the update form's fields as title, status, assignee and description —
      // a task belongs to its project for its lifetime.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const assignee = parseUpdateAssignee({ assigneeId: body.assigneeId });

      if (!assignee.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to update task.",
          assignee.errors,
        );
      }

      const result = await model.update(id, {
        ...fields.data,
        assigneeId: assignee.assigneeId,
      });

      if (result.status === "assignee-missing") {
        throw HttpError.validation("Missing fields. Failed to update task.", {
          assigneeId: ["That assignee no longer exists."],
        });
      }

      if (result.status === "missing") {
        throw HttpError.notFound("That task no longer exists.");
      }

      res.status(200).json({
        ok: true,
        message: "Task updated.",
        redirectTo: `/tasks/${id}`,
      });
    },

    async remove(req, res) {
      const id = requireId(req.params.id);
      const removed = await model.remove(id);

      if (!removed) {
        throw HttpError.notFound("That task no longer exists.");
      }

      // Straight to the board: the detail page for this id is now not-found,
      // so redirecting there would land the user on a dead URL.
      res.status(200).json({
        ok: true,
        message: "Task deleted.",
        redirectTo: `/projects/${removed.projectId}`,
      });
    },

    async addComment(req, res) {
      const id = requireId(req.params.id);
      const parsed = parseCommentBody(req.body);

      if (!parsed.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to add the comment.",
          parsed.errors,
        );
      }

      const result = await model.addComment(id, parsed.data);

      if (result.status === "task-missing") {
        throw HttpError.notFound("That task no longer exists.");
      }

      if (result.status === "author-missing") {
        throw HttpError.validation(
          "Missing fields. Failed to add the comment.",
          {
            authorId: ["That comment author no longer exists."],
          },
        );
      }

      // No redirect, mirroring the reference's createComment return exactly:
      // the user stays on the task detail page and sees the comment they just
      // wrote in the list above the form, so there is no `redirectTo` (and no
      // message) to return — `ok: true` is the whole reply.
      res.status(201).json({ ok: true });
    },
  };
}
