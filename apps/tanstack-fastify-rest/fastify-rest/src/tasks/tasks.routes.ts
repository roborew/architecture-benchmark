// src/tasks/tasks.routes.ts
//
// The routing layer for tasks: maps the REST surface onto controller calls.
// Registered by the app factory under the /api/tasks prefix, so this file
// never sees the mount point and can be mounted anywhere without changes —
// the Fastify plugin (`FastifyPluginAsync` + `register` options) is the
// counterpart of the Express `Router()` the app factory `use()`s under a path
// prefix.
//
// `/count` and `/with-comment` cannot be captured by the `/:id` shapes here,
// unlike the Express variant where registration order was the whole contract
// of that: Fastify's router (find-my-way) matches by route specificity, so a
// literal segment always wins over a parameter regardless of the order the
// routes are declared in.

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import type { TasksController } from "./tasks.controller.ts";

export interface TasksRoutesOptions {
  /** The controller every route delegates to. Supplied by the app factory. */
  controller: TasksController;
}

export const tasksRoutes: FastifyPluginAsync<TasksRoutesOptions> = async (
  app: FastifyInstance,
  options,
) => {
  app.get("/", options.controller.list);
  app.get("/count", options.controller.count);
  app.post("/with-comment", options.controller.createWithComment);
  app.post("/", options.controller.create);
  app.get("/:id/comments", options.controller.listComments);
  app.post("/:id/comments", options.controller.addComment);
  app.get("/:id", options.controller.get);
  app.patch("/:id", options.controller.update);
  app.delete("/:id", options.controller.remove);
};
