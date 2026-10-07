// src/users/users.routes.ts
//
// The routing layer for users: maps the REST surface onto controller calls.
// Mounted by the app factory under /api/users, so this file never sees the
// mount point and can be mounted anywhere without changes.

import { Router } from "express";

import type { TasksController } from "./tasks.controller.ts";

export function createTasksRouter(controller: TasksController): Router {
  const router = Router();

  router.get("/", controller.list);

  return router;
}
