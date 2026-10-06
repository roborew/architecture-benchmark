// src/users/users.model.ts
//
// The model layer for users: the only place that knows SQL. Replicates the
// aggregate query the tanstack-start-react variant serves through a
// createServerFn, so both apps return identical rows for the same database.
//
// Every count is DISTINCT on its own side's key because the two LEFT JOINs
// multiply: a member with 2 tasks and 2 comments produces 4 rows, and a plain
// COUNT over that join would report 4 tasks.

import type { Db } from "../db/connection.ts";

export type User = {
  id: number;
  name: string;
  email: string;
  assignedTaskCount: number;
  openTaskCount: number;
  commentCount: number;
};

export interface UsersModel {
  /**
   * The workspace members with their aggregate counts, ordered by
   * `display_name DESC, id DESC`. An empty `term` returns every member.
   */
  list(term: string): Promise<User[]>;
}

// ILIKE treats %, _ and \ as wildcards, so a search for "100%" must not match
// every row — the term is escaped before it reaches the pattern.
const escapeLike = (term: string) => term.replace(/[\\%_]/g, "\\$&");

export function createUsersModel(db: Db): UsersModel {
  // The aggregate projection. Fragments are built per model instance because
  // postgres.js builds them from the connection itself.
  const USER_AGGREGATES = db`
    SELECT
      u.id::int AS id,
      u.display_name AS name,
      u.email,
      COUNT(DISTINCT t.id)::int AS "assignedTaskCount",
      COUNT(DISTINCT t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
      COUNT(DISTINCT c.id)::int AS "commentCount"
    FROM users u
    LEFT JOIN tasks t ON u.id = t.assignee_id
    LEFT JOIN comments c ON u.id = c.author_id
  `;

  return {
    async list(term) {
      const where = term
        ? db`WHERE u.display_name ILIKE ${`%${escapeLike(term)}%`}
              OR u.email ILIKE ${`%${escapeLike(term)}%`}`
        : db``;

      try {
        return await db<User[]>`
          ${USER_AGGREGATES}
          ${where}
          GROUP BY u.id, u.display_name, u.email
          ORDER BY u.display_name DESC, u.id DESC
        `;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch users.");
      }
    },
  };
}
