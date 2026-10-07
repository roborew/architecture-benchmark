// src/dashboard/dashboard.model.ts
//
// The model layer for the dashboard: the only place that knows the dashboard
// SQL. Mirrors the reference variant (apps/tanstack-start-react/src/lib/
// data.ts — getDashboardStats, getRecentTasks, getDashboardProjects)
// statement for statement, so both apps return identical rows for the same
// database.
//
// The dashboard's task rows use their own slimmer projection rather than the
// shared task projection (src/lib/task-projection.ts): the recent-tasks table
// shows no description, project id or comment count, and pulling columns the
// card never renders would cost the join for nothing.

import type { Db } from "../db/connection.ts";

/** How many rows each dashboard section shows. */
const DASHBOARD_RECENT_TASKS = 3;
const DASHBOARD_PROJECTS = 2;

export type DashboardStats = {
  projectCount: number;
  totalTasks: number;
  openTasks: number;
  peopleCount: number;
  todoTasks: number;
  inProgressTasks: number;
  doneTasks: number;
};

/** The recent-tasks table's row: a task without project id, description or comment count. */
export type DashboardTask = {
  id: number;
  title: string;
  projectName: string;
  status: string;
  assigneeName: string;
  updatedAt: string;
};

/** The dashboard card's project: the listing row without the creation date. */
export type DashboardProject = {
  id: number;
  name: string;
  description: string;
  taskCount: number;
  openTaskCount: number;
  peopleCount: number;
};

export interface DashboardModel {
  /** Workspace totals for the stat cards. */
  stats(): Promise<DashboardStats>;

  /**
   * The most recently updated tasks, for the recent table. Ordered by
   * `updated_at` rather than `created_at`: "recent activity" means when the
   * work last moved, which is also what `updateTask` advances.
   */
  recentTasks(): Promise<DashboardTask[]>;

  /**
   * The busiest projects, for the project cards. Ordered by task count so the
   * cards answer "where is the work?" rather than repeating the newest-first
   * ordering of every other list.
   */
  projects(): Promise<DashboardProject[]>;
}

export function createDashboardModel(db: Db): DashboardModel {
  return {
    async stats() {
      try {
        // One statement rather than three, because the cards are rendered
        // together and separate COUNT queries would each scan a different
        // table for the same row.
        const [stats] = await db<DashboardStats[]>`
          SELECT
            (SELECT COUNT(*) FROM projects)::int AS "projectCount",
            (SELECT COUNT(*) FROM tasks)::int AS "totalTasks",
            (
              SELECT COUNT(*) FROM tasks WHERE status <> 'done'
            )::int AS "openTasks",
            (SELECT COUNT(*) FROM users)::int AS "peopleCount",
            (SELECT COUNT(*) FROM tasks WHERE status = 'todo')::int AS "todoTasks",
            (
              SELECT COUNT(*) FROM tasks WHERE status = 'in progress'
            )::int AS "inProgressTasks",
            (SELECT COUNT(*) FROM tasks WHERE status = 'done')::int AS "doneTasks"
        `;

        return stats;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch the dashboard stats.");
      }
    },

    async recentTasks() {
      try {
        return await db<DashboardTask[]>`
          SELECT
            t.id::int AS id,
            t.title,
            p.name AS "projectName",
            t.status,
            COALESCE(u.display_name, 'Unassigned') AS "assigneeName",
            to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
          FROM tasks t
          JOIN projects p ON p.id = t.project_id
          LEFT JOIN users u ON u.id = t.assignee_id
          ORDER BY t.updated_at DESC, t.id DESC
          LIMIT ${DASHBOARD_RECENT_TASKS}
        `;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch recent tasks.");
      }
    },

    async projects() {
      try {
        return await db<DashboardProject[]>`
          SELECT
            p.id::int AS id,
            p.name,
            p.description,
            COUNT(t.id)::int AS "taskCount",
            COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
            COUNT(DISTINCT t.assignee_id)::int AS "peopleCount"
          FROM projects p
          LEFT JOIN tasks t ON p.id = t.project_id
          GROUP BY p.id, p.name, p.description
          ORDER BY COUNT(t.id) DESC, p.id ASC
          LIMIT ${DASHBOARD_PROJECTS}
        `;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch dashboard projects.");
      }
    },
  };
}
