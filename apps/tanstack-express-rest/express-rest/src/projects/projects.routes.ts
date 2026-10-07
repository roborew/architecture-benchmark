// src/projects/projects.routes.ts
//
// The routing layer for projects: maps the REST surface onto controller calls.
// Mounted by the app factory under /api/projects, so this file never sees the
// mount point and can be mounted anywhere without changes.

import { Router } from "express";

import type { ProjectsController } from "./projects.controller.ts";

export function createProjectsRouter(controller: ProjectsController): Router {
  const router = Router();

  router.get("/", controller.list);
  router.get("/:id/tasks", controller.listTasks);
  router.get("/:id", controller.get);
  router.post("/", controller.create);
  router.patch("/:id", controller.update);
  router.delete("/:id", controller.remove);

  return router;
}
