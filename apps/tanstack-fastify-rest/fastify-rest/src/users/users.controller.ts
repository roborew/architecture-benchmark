// src/users/users.controller.ts
//
// The controller layer: validates the request, translates it into a model
// call, and writes the model's result to the response. It knows Fastify types
// and nothing about SQL; the model knows SQL and nothing about HTTP.
//
// Validation lives in src/users/users.validator.ts (bodies) and
// src/lib/query.validator.ts (q / :id). Failures are thrown as HttpError and
// mapped to their JSON envelope by the error handler; successes are written
// here, including the `redirectTo` the reference's actions return, which is
// where the SPA navigates next.

import type { FastifyReply, FastifyRequest } from "fastify";

import { HttpError } from "../lib/http-error.ts";
import { parseIdParam, parseSearchTerm } from "../lib/query.validator.ts";
import type { UsersModel } from "./users.model.ts";
import { parseUserBody } from "./users.validator.ts";

export interface UsersController {
  /** GET /api/users?q=… — the People listing page's rows. */
  list(request: FastifyRequest, reply: FastifyReply): Promise<void>;

  /** GET /api/users/:id — one member with the same shape `list` returns. */
  get(request: FastifyRequest, reply: FastifyReply): Promise<void>;

  /** GET /api/users/:id/tasks — the tasks assigned to one member. */
  listTasks(request: FastifyRequest, reply: FastifyReply): Promise<void>;

  /** POST /api/users — insert one member, redirect to their page. */
  create(request: FastifyRequest, reply: FastifyReply): Promise<void>;

  /** PATCH /api/users/:id — update one member by primary key. */
  update(request: FastifyRequest, reply: FastifyReply): Promise<void>;

  /** DELETE /api/users/:id — delete one member, or 409 while they authored comments. */
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

export function createUsersController(model: UsersModel): UsersController {
  return {
    async list(request, reply) {
      const query = request.query as Record<string, unknown>;
      const parsed = parseSearchTerm(query.q);

      if (!parsed.ok) {
        throw new HttpError(400, { error: parsed.error });
      }

      const users = await model.list(parsed.term);

      reply.status(200).send(users);
    },

    async get(request, reply) {
      const params = request.params as Record<string, unknown>;
      const id = requireId(params.id);
      const user = await model.get(id);

      if (!user) {
        throw HttpError.notFound("Not found");
      }

      reply.status(200).send(user);
    },

    async listTasks(request, reply) {
      const params = request.params as Record<string, unknown>;
      const id = requireId(params.id);
      const tasks = await model.listTasks(id);

      reply.status(200).send(tasks);
    },

    async create(request, reply) {
      const parsed = parseUserBody(request.body);

      if (!parsed.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to create user.",
          parsed.errors,
        );
      }

      const created = await model.create(parsed.data);

      reply.status(201).send({
        ok: true,
        message: "User created.",
        redirectTo: `/users/${created.id}`,
      });
    },

    async update(request, reply) {
      const params = request.params as Record<string, unknown>;
      const id = requireId(params.id);
      const parsed = parseUserBody(request.body);

      if (!parsed.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to update user.",
          parsed.errors,
        );
      }

      const result = await model.update(id, parsed.data);

      if (result.status === "missing") {
        throw HttpError.notFound("That user no longer exists.");
      }

      reply.status(200).send({
        ok: true,
        message: "User updated.",
        redirectTo: `/users/${id}`,
      });
    },

    async remove(request, reply) {
      const params = request.params as Record<string, unknown>;
      const id = requireId(params.id);
      const result = await model.remove(id);

      if (result.status === "missing") {
        throw HttpError.notFound("That user no longer exists.");
      }

      if (result.status === "restricted") {
        // A member who has authored comments cannot be removed (FK RESTRICT);
        // the reference reports why as an actionable message, which this API
        // answers as a 409 with the same string.
        throw HttpError.conflict(result.message);
      }

      reply.status(200).send({
        ok: true,
        message: "User deleted.",
        redirectTo: "/users",
      });
    },
  };
}
