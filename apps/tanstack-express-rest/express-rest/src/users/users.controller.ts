// src/users/users.controller.ts
//
// The controller layer: validates the request, translates it into a model
// call, and writes the model's result to the response. It knows Express types
// and nothing about SQL; the model knows SQL and nothing about HTTP.
//
// Validation lives in src/users/users.validator.ts (bodies) and
// src/lib/query.validator.ts (q / :id). Failures are thrown as HttpError and
// mapped to their JSON envelope by the error handler; successes are written
// here, including the `redirectTo` the reference's actions return, which is
// where the SPA navigates next.

import type { Request, Response } from "express";

import { HttpError } from "../lib/http-error.ts";
import { parseIdParam, parseSearchTerm } from "../lib/query.validator.ts";
import type { UsersModel } from "./users.model.ts";
import { parseUserBody } from "./users.validator.ts";

export interface UsersController {
  /** GET /api/users?q=… — the People listing page's rows. */
  list(req: Request, res: Response): Promise<void>;

  /** GET /api/users/:id — one member with the same shape `list` returns. */
  get(req: Request, res: Response): Promise<void>;

  /** GET /api/users/:id/tasks — the tasks assigned to one member. */
  listTasks(req: Request, res: Response): Promise<void>;

  /** POST /api/users — insert one member, redirect to their page. */
  create(req: Request, res: Response): Promise<void>;

  /** PATCH /api/users/:id — update one member by primary key. */
  update(req: Request, res: Response): Promise<void>;

  /** DELETE /api/users/:id — delete one member, or 409 while they authored comments. */
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

export function createUsersController(model: UsersModel): UsersController {
  return {
    async list(req, res) {
      const parsed = parseSearchTerm(req.query.q);

      if (!parsed.ok) {
        throw new HttpError(400, { error: parsed.error });
      }

      const users = await model.list(parsed.term);

      res.status(200).json(users);
    },

    async get(req, res) {
      const id = requireId(req.params.id);
      const user = await model.get(id);

      if (!user) {
        throw HttpError.notFound("Not found");
      }

      res.status(200).json(user);
    },

    async listTasks(req, res) {
      const id = requireId(req.params.id);
      const tasks = await model.listTasks(id);

      res.status(200).json(tasks);
    },

    async create(req, res) {
      const parsed = parseUserBody(req.body);

      if (!parsed.ok) {
        throw HttpError.validation(
          "Missing fields. Failed to create user.",
          parsed.errors,
        );
      }

      const created = await model.create(parsed.data);

      res.status(201).json({
        ok: true,
        message: "User created.",
        redirectTo: `/users/${created.id}`,
      });
    },

    async update(req, res) {
      const id = requireId(req.params.id);
      const parsed = parseUserBody(req.body);

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

      res.status(200).json({
        ok: true,
        message: "User updated.",
        redirectTo: `/users/${id}`,
      });
    },

    async remove(req, res) {
      const id = requireId(req.params.id);
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

      res.status(200).json({
        ok: true,
        message: "User deleted.",
        redirectTo: "/users",
      });
    },
  };
}
