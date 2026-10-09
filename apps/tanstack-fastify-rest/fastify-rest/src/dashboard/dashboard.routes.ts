// src/dashboard/dashboard.routes.ts
//
// The routing layer for the dashboard: maps the REST surface onto controller
// calls. Registered by the app factory under the /api/dashboard prefix, so
// this file never sees the mount point and can be mounted anywhere without
// changes — the Fastify plugin (`FastifyPluginAsync` + `register` options) is
// the counterpart of the Express `Router()` the app factory `use()`s under a
// path prefix.

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import type { DashboardController } from "./dashboard.controller.ts";

export interface DashboardRoutesOptions {
  /** The controller the route delegates to. Supplied by the app factory. */
  controller: DashboardController;
}

export const dashboardRoutes: FastifyPluginAsync<DashboardRoutesOptions> =
  async (app: FastifyInstance, options) => {
    app.get("/", options.controller.get);
  };
