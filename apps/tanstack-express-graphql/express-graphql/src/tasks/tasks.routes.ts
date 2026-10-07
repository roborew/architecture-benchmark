// src/tasks/tasks.routes.ts
//
// The routing layer for tasks: maps the REST surface onto controller calls.
// Mounted by the app factory under /api/tasks, so this file never sees the
// mount point and can be mounted anywhere without changes.
//
// `/count` and `/with-comment` are registered before the `/:id` shapes: an
// Express route matches in registration order, so a literal segment must come
// before a parameter that would otherwise capture it ("count" as a task id,
// "with-comment" as a task id).

import { Router } from "express";

import type { TasksController } from "./tasks.controller.ts";

export function createTasksRouter(controller: TasksController): Router {
  const router = Router();

  router.get("/", controller.list);
  router.get("/count", controller.count);
  router.post("/with-comment", controller.createWithComment);
  router.post("/", controller.create);
  router.get("/:id/comments", controller.listComments);
  router.post("/:id/comments", controller.addComment);
  router.get("/:id", controller.get);
  router.patch("/:id", controller.update);
  router.delete("/:id", controller.remove);

  return router;
}
