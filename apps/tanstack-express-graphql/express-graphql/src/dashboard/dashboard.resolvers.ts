// src/dashboard/dashboard.resolvers.ts
//
// The resolver layer for the dashboard: the one read this surface has. The
// three sections render together, so they are fetched together; one slow
// section should not be the reason the cards appear one by one.

import type { DashboardModel } from "./dashboard.model.ts";

export function createDashboardResolvers(model: DashboardModel) {
  return {
    Query: {
      /** The stats, the recent tasks and the busiest projects, together. */
      async dashboard() {
        const [stats, recentTasks, projects] = await Promise.all([
          model.stats(),
          model.recentTasks(),
          model.projects(),
        ]);

        return { stats, recentTasks, projects };
      },
    },
  };
}
