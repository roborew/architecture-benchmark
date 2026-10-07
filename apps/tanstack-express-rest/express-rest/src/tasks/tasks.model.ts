// src/tasks/tasks.model.ts
//
// The model layer for tasks: the only place that knows SQL. Replicates the
// workspace-wide task list the tanstack-start-react variant serves through
// `getTasks`, so both apps return identical rows for the same database.
//
// The row is the shared task projection every page that renders a task uses:
// the project name from its join, the assignee name COALESCEed for unassigned
// tasks, and the comment count aggregated here so the listing needs no second
// query. A task's stored status reaches the client untranslated — the stored
// values are the contract.

import type { Db } from "../db/connection.ts";

export type Task = {
  id: number;
  projectId: number;
  projectName: string;
  title: string;
  description: string;
  status: string;
  assigneeName: string;
  commentCount: number;
  updatedAt: string;
};

export interface TasksModel {
  /**
   * The workspace-wide task list, ordered by `updated_at DESC, id DESC`.
   * An empty `term` returns every task.
   */
  list(term: string): Promise<Task[]>;
}

// ILIKE treats %, _ and \ as wildcards, so a search for "100%" must not match
// every row — the term is escaped before it reaches the pattern.
const escapeLike = (term: string) => term.replace(/[\\%_]/g, "\\$&");

export function createTasksModel(db: Db): TasksModel {
  // The aggregate projection. Fragments are built per model instance because
  // postgres.js builds them from the connection itself.
  //
  // COUNT(c.id) needs no DISTINCT here: comments is the only one-to-many join
  // in the chain, so the row count multiplies only by the task's own comments.
  // (The users model joins two one-to-many sides at once, which is why its
  // counts must be DISTINCT — a member with 2 tasks and 2 comments produces 4
  // rows there.)
  const TASK_AGGREGATES = db`
    SELECT
      t.id::int AS id,
      t.project_id::int AS "projectId",
      p.name AS "projectName",
      t.title,
      t.description,
      t.status,
      COALESCE(u.display_name, 'Unassigned') AS "assigneeName",
      COUNT(c.id)::int AS "commentCount",
      to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN comments c ON c.task_id = t.id
  `;

  return {
    async list(term) {
      // The listing search: case-insensitive, across title or description.
      const where = term
        ? db`WHERE (t.title ILIKE ${`%${escapeLike(term)}%`}
              OR t.description ILIKE ${`%${escapeLike(term)}%`})`
        : db``;

      try {
        return await db<Task[]>`
          ${TASK_AGGREGATES}
          ${where}
          GROUP BY t.id, p.name, u.display_name, t.updated_at
          ORDER BY t.updated_at DESC, t.id DESC
        `;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch tasks.");
      }
    },
  };
}
