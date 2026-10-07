// src/projects/projects.controller.ts
//
// The controller layer: validates the request, translates it into a model
// call, and writes the model's result to the response. It knows Express types
// and nothing about SQL; the model knows SQL and nothing about HTTP.
//
// Validation lives in src/projects/projects.validator.ts (bodies) and
// src/lib/query.validator.ts (q / :id); the board's task-list params are
// validated by the tasks domain's pure validator, because the board's rows are
// task rows. Failures are thrown as HttpError and mapped to their JSON envelope
// by the error handler; successes are written here, including the `redirectTo`
// the reference's actions return, which is where the SPA navigates next.

import type { Request, Response } from "express";

import { HttpError } from "../lib/http-error.ts";
import { parseIdParam, parseSearchTerm } from "../lib/query.validator.ts";
import { parseProjectTaskListQuery } from "../tasks/tasks.validator.ts";
import type { ProjectsModel } from "./projects.model.ts";
import { parseProjectBody } from "./projects.validator.ts";

export interface ProjectsController {
  /** GET /api/projects — every project with its aggregate counts. */
  list(req: Request, res: Response): Promise<void>;

  /** GET /api/projects/:id — one project with the same shape `list` returns. */
  get(req: Request, res: Response): Promise<void>;

  /** GET /api/projects/:id/tasks — one keyset page of a project's board. */
  listTasks(req: Request, res: Response): Promise<void>;

  /** POST /api/projects — insert one project, redirect to its board. */
  create(req: Request, res: Response): Promise<void>;

  /** PATCH /api/projects/:id — update one project by primary key. */
  update(req: Request, res: Response): Promise<void>;

  /** DELETE /api/projects/:id — delete one project, or 409 while it has tasks. */
  remove(req: Request, res: Response): Promise<void>;
}

/** The `:id` a detail/update/delete URL names, or a 400 envelope. */
function requireId(raw: unknown): number {
  const parsed = parseIdParam(raw);

  if (!parsed.ok) {
    throw new HttpError(400, { error: parsed.error });
  }

  return parsed.id;
}

export function createProjectsController(model: ProjectsModel): ProjectsController {
  return {
    async list(req, res) {
      const parsed = parseSearchTerm(req.query.q);

      if (!parsed.ok) {
        throw new HttpError(400, { error: parsed.error });
      }

      const projects = await model.list(parsed.term);

      res.status(200).json(projects);
    },

    async get(req, res) {
      const id = requireId(req.params.id);
      const project = await model.get(id);

      if (!project) {
        throw HttpError.notFound("Not found");
      }

      res.status(200).json(project);
    },

    async listTasks(req, res) {
      const id = requireId(req.params.id);
      const parsed = parseProjectTaskListQuery(
        req.query as Record<string, unknown>,
      );

      if (!parsed.ok) {
        throw new HttpError(400, { error: parsed.error });
      }

      const tasks = await model.listTasks(id, parsed.filters);

      res.status(200).json(tasks);
    },

    async create(req, res) {
      const parsed = parseProjectBody(req.body);

      if (!parsed.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to create project.",
          parsed.errors,
        );
      }

      const created = await model.create(parsed.data);

      res.status(201).json({
        ok: true,
        message: "Project created.",
        redirectTo: `/projects/${created.id}`,
      });
    },

    async update(req, res) {
      const id = requireId(req.params.id);
      const parsed = parseProjectBody(req.body);

      if (!parsed.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to update project.",
          parsed.errors,
        );
      }

      const result = await model.update(id, parsed.data);

      if (result.status === "missing") {
        throw HttpError.notFound("That project no longer exists.");
      }

      res.status(200).json({
        ok: true,
        message: "Project updated.",
        redirectTo: `/projects/${id}`,
      });
    },

    async remove(req, res) {
      const id = requireId(req.params.id);
      const result = await model.remove(id);

      if (result.status === "missing") {
        throw HttpError.notFound("That project no longer exists.");
      }

      if (result.status === "restricted") {
        // A project that still has tasks cannot be removed (FK RESTRICT); the
        // reference reports why as an actionable message, which this API
        // answers as a 409 with the same string.
        throw HttpError.conflict(result.message);
      }

      res.status(200).json({
        ok: true,
        message: "Project deleted.",
        redirectTo: "/projects",
      });
    },
  };
}
