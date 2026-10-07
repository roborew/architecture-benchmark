// src/users/users.controller.ts
//
// The controller layer: validates the request, translates it into a model
// call, and writes the model's result to the response. It knows Express types
// and nothing about SQL; the model knows SQL and nothing about HTTP.

import type { Request, Response } from "express";

import type { TasksModel } from "./tasks.model.ts";
import { parseSearchTerm } from "../lib/query.validator.ts";

export interface TasksController {
  /** GET /api/users?q=… — the People listing page's rows. */
  list(req: Request, res: Response): Promise<void>;
}

export function createTasksController(model: TasksModel): TasksController {
  return {
    async list(req, res) {
      const parsed = parseSearchTerm(req.query.q);

      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const tasks = await model.list(parsed.term);
      res.status(200).json(tasks);
    },
  };
}
