// src/users/users.controller.ts
//
// The controller layer: translates an HTTP request into a model call and the
// model's result into an HTTP response. It knows Express types and nothing
// about SQL; the model knows SQL and nothing about HTTP.

import type { Request, Response } from "express";

import type { UsersModel } from "./users.model.ts";

export interface UsersController {
  /** GET /api/users?q=… — the People listing page's rows. */
  list(req: Request, res: Response): Promise<void>;
}

export function createUsersController(model: UsersModel): UsersController {
  return {
    async list(req, res) {
      const term = typeof req.query.q === "string" ? req.query.q.trim() : "";

      const users = await model.list(term);

      res.status(200).json(users);
    },
  };
}
