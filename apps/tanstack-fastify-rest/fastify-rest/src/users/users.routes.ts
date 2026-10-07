// src/users/users.routes.ts
//
// The routing layer for users: maps the REST surface onto controller calls.
// Registered by the app factory under the /api/users prefix, so this file
// never sees the mount point and can be mounted anywhere without changes —
// the Fastify plugin (`FastifyPluginAsync` + `register` options) is the
// counterpart of the Express `Router()` the app factory `use()`s under a path
// prefix.

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import type { UsersController } from "./users.controller.ts";

export interface UsersRoutesOptions {
  /** The controller every route delegates to. Supplied by the app factory. */
  controller: UsersController;
}

export const usersRoutes: FastifyPluginAsync<UsersRoutesOptions> = async (
  app: FastifyInstance,
  options,
) => {
  app.get("/", options.controller.list);
  app.get("/:id/tasks", options.controller.listTasks);
  app.get("/:id", options.controller.get);
  app.post("/", options.controller.create);
  app.patch("/:id", options.controller.update);
  app.delete("/:id", options.controller.remove);
};
