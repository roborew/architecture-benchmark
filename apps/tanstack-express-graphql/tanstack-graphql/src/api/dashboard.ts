// src/api/dashboard.ts
//
// How the SPA talks to the server about the dashboard: one aggregate — the
// stats, the recent tasks and the busiest projects — exactly as the home page
// renders them together. Transport details live in `api/api.ts`.

import type { DashboardData } from "@/lib/types";
import { request } from "./api";

const DASHBOARD_QUERY = /* GraphQL */ `
  query Dashboard {
    dashboard {
      stats {
        projectCount
        totalTasks
        openTasks
        peopleCount
        todoTasks
        inProgressTasks
        doneTasks
      }
      recentTasks {
        id
        title
        projectName
        status
        assigneeName
        updatedAt
      }
      projects {
        id
        name
        description
        taskCount
        openTaskCount
        peopleCount
      }
    }
  }
`;

/** The dashboard aggregate: stats, recent tasks and the busiest projects. */
export function getDashboard(): Promise<DashboardData> {
	return request<{ dashboard: DashboardData }>(DASHBOARD_QUERY).then(
		(data) => data.dashboard,
	);
}
