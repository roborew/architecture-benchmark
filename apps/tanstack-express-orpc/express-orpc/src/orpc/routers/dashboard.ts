// src/orpc/routers/dashboard.ts
//
// The dashboard domain: the one read this surface has. It knows the contract
// and nothing about SQL; the model knows SQL and nothing about the transport.
//
// The three sections are fetched with one `Promise.all` rather than merged
// into one model call: the sections render together, so one slow section
// should not be the reason the cards appear one by one.

import { implement } from "@orpc/server";

import type { DashboardModel } from "../../dashboard/dashboard.model.ts";
import { dashboardContract } from "../contract.ts";

const os = implement(dashboardContract);

export function createDashboardRouter(model: DashboardModel) {
  return os.router({
    get: os.get.handler(async () => {
      const [stats, recentTasks, projects] = await Promise.all([
        model.stats(),
        model.recentTasks(),
        model.projects(),
      ]);

      return { stats, recentTasks, projects };
    }),
  });
}

export type DashboardRouter = ReturnType<typeof createDashboardRouter>;
