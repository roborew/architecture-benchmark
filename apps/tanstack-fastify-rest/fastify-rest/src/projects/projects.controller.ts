// src/projects/projects.controller.ts
//
// The controller layer: validates the request, translates it into a model
// call, and writes the model's result to the response. It knows Fastify types
// and nothing about SQL; the model knows SQL and nothing about HTTP.
//
// Validation lives in src/projects/projects.validator.ts (bodies) and
// src/lib/query.validator.ts (q / :id); the board's task-list params are
// validated by the tasks domain's pure validator, because the board's rows
// are task rows. Failures are thrown as HttpError and mapped to their JSON
// envelope by the error handler; successes are written here, including the
// `redirectTo` the reference's actions return, which is where the SPA
// navigates next.
//
// The request's parts (query/body/params) are untyped at this layer on
// purpose: no JSON Schema is attached to the routes, because the zod
// validators — not the framework — own the error messages, and those strings
// are the client contract. The one cast per part hands the raw value to the
// same pure validators the Express variant uses.

import type { FastifyReply, FastifyRequest } from "fastify";

import { HttpError } from "../lib/http-error.ts";
import { parseIdParam, parseSearchTerm } from "../lib/query.validator.ts";
import { parseProjectTaskListQuery } from "../tasks/tasks.validator.ts";
import type { ProjectsModel } from "./projects.model.ts";
import { parseProjectBody } from "./projects.validator.ts";

export interface ProjectsController {
  /** GET /api/projects — every project with its aggregate counts. */
  list(request: FastifyRequest, reply: FastifyReply): Promise<void>;

  /** GET /api/projects/:id — one project with the same shape `list` returns. */
  get(request: FastifyRequest, reply: FastifyReply): Promise<void>;

  /** GET /api/projects/:id/tasks — one keyset page of a project's board. */
  listTasks(request: FastifyRequest, reply: FastifyReply): Promise<void>;

  /** POST /api/projects — insert one project, redirect to its board. */
  create(request: FastifyRequest, reply: FastifyReply): Promise<void>;

  /** PATCH /api/projects/:id — update one project by primary key. */
  update(request: FastifyRequest, reply: FastifyReply): Promise<void>;

  /** DELETE /api/projects/:id — delete one project, or 409 while it has tasks. */
  remove(request: FastifyRequest, reply: FastifyReply): Promise<void>;
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
    async list(request, reply) {
      const query = request.query as Record<string, unknown>;
      const parsed = parseSearchTerm(query.q);

      if (!parsed.ok) {
        throw new HttpError(400, { error: parsed.error });
      }

      const projects = await model.list(parsed.term);

      reply.status(200).send(projects);
    },

    async get(request, reply) {
      const params = request.params as Record<string, unknown>;
      const id = requireId(params.id);
      const project = await model.get(id);

      if (!project) {
        throw HttpError.notFound("Not found");
      }

      reply.status(200).send(project);
    },

    async listTasks(request, reply) {
      const params = request.params as Record<string, unknown>;
      const id = requireId(params.id);
      const parsed = parseProjectTaskListQuery(
        request.query as Record<string, unknown>,
      );

      if (!parsed.ok) {
        throw new HttpError(400, { error: parsed.error });
      }

      const tasks = await model.listTasks(id, parsed.filters);

      reply.status(200).send(tasks);
    },

    async create(request, reply) {
      const parsed = parseProjectBody(request.body);

      if (!parsed.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to create project.",
          parsed.errors,
        );
      }

      const created = await model.create(parsed.data);

      reply.status(201).send({
        ok: true,
        message: "Project created.",
        redirectTo: `/projects/${created.id}`,
      });
    },

    async update(request, reply) {
      const params = request.params as Record<string, unknown>;
      const id = requireId(params.id);
      const parsed = parseProjectBody(request.body);

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

      reply.status(200).send({
        ok: true,
        message: "Project updated.",
        redirectTo: `/projects/${id}`,
      });
    },

    async remove(request, reply) {
      const params = request.params as Record<string, unknown>;
      const id = requireId(params.id);
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

      reply.status(200).send({
        ok: true,
        message: "Project deleted.",
        redirectTo: "/projects",
      });
    },
  };
}
