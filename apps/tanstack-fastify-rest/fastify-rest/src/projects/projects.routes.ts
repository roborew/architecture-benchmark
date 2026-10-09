// src/projects/projects.routes.ts
//
// The routing layer for projects: maps the REST surface onto controller calls.
// Registered by the app factory under the /api/projects prefix, so this file
// never sees the mount point and can be mounted anywhere without changes —
// the Fastify plugin (`FastifyPluginAsync` + `register` options) is the
// counterpart of the Express `Router()` the app factory `use()`s under a path
// prefix.
//
// The controller arrives through the plugin's options rather than being built
// here: the composition root owns the dependency chain (connection → model →
// controller → routes), and the routes layer stays a pure map from the REST
// surface onto controller calls.
//
// No registration-order contract here, unlike the Express variant: Fastify's
// router (find-my-way) matches by route specificity — a literal segment
// (`/count`, `/with-comment`) always wins over a parameter (`/:id`) — so
// `/:id` cannot capture "count" no matter when it is declared.

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import type { ProjectsController } from "./projects.controller.ts";

export interface ProjectsRoutesOptions {
  /** The controller every route delegates to. Supplied by the app factory. */
  controller: ProjectsController;
}

export const projectsRoutes: FastifyPluginAsync<ProjectsRoutesOptions> =
  async (app: FastifyInstance, options) => {
    app.get("/", options.controller.list);
    app.get("/:id/tasks", options.controller.listTasks);
    app.get("/:id", options.controller.get);
    app.post("/", options.controller.create);
    app.patch("/:id", options.controller.update);
    app.delete("/:id", options.controller.remove);
  };
