// src/tasks/tasks.routes.ts
//
// The routing layer for tasks: maps the REST surface onto controller calls.
// Registered by the app factory under the /api/tasks prefix, so this file
// never sees the mount point and can be mounted anywhere without changes —
// the Fastify plugin (`FastifyPluginAsync` + `register` options) is the
// counterpart of the Express `Router()` the app factory `use()`s under a path
// prefix.
//
// The read surface first; the write routes (POST/PATCH/DELETE, with-comment
// and the comments endpoint) land with their own integration tier.
//
// `/count` cannot be captured by the `/:id` shapes here, unlike the Express
// variant where registration order was the whole contract of that: Fastify's
// router (find-my-way) matches by route specificity, so a literal segment
// always wins over a parameter regardless of the order the routes are
// declared in.

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
  app.get("/:id/comments", options.controller.listComments);
  app.get("/:id", options.controller.get);
};
