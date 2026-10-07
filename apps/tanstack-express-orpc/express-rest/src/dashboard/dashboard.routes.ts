// src/dashboard/dashboard.routes.ts
//
// The routing layer for the dashboard: maps the REST surface onto controller
// calls. Mounted by the app factory under /api/dashboard, so this file never
// sees the mount point and can be mounted anywhere without changes.

import { Router } from "express";

import type { DashboardController } from "./dashboard.controller.ts";

export function createDashboardRouter(
  controller: DashboardController,
): Router {
  const router = Router();

  router.get("/", controller.get);

  return router;
}
