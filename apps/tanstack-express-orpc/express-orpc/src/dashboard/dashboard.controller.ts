// src/dashboard/dashboard.controller.ts
//
// The controller layer: the one read this surface has. It knows Express types
// and nothing about SQL; the model knows SQL and nothing about HTTP.

import type { Request, Response } from "express";

import type { DashboardModel } from "./dashboard.model.ts";

export interface DashboardController {
  /** GET /api/dashboard — the stats, recent tasks and busiest projects. */
  get(req: Request, res: Response): Promise<void>;
}

export function createDashboardController(
  model: DashboardModel,
): DashboardController {
  return {
    async get(_req, res) {
      // The three sections render together, so they are fetched together; one
      // slow section should not be the reason the cards appear one by one.
      const [stats, recentTasks, projects] = await Promise.all([
        model.stats(),
        model.recentTasks(),
        model.projects(),
      ]);

      res.status(200).json({ stats, recentTasks, projects });
    },
  };
}
