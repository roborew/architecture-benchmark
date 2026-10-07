// src/users/users.model.ts
//
// The model layer for users: the only place that knows the users SQL.
// Mirrors the reference variant's reads (apps/tanstack-start-react/src/lib/
// data.ts — getUsers, getUser, getUserTasks) and writes (actions.ts —
// createUser, updateUser, deleteUser) statement for statement, so both apps
// return identical rows and make identical changes for the same database.
//
// Every count is DISTINCT on its own side's key because the two LEFT JOINs
// multiply: a member with 2 tasks and 2 comments produces 4 rows, and a plain
// COUNT over that join would report 4 tasks.

import type { Db } from "../db/connection.ts";
import {
  taskProjectionFields,
  taskProjectionFrom,
} from "../lib/task-projection.ts";
import type { Task } from "../tasks/tasks.model.ts";

export type User = {
  id: number;
  name: string;
  email: string;
  assignedTaskCount: number;
  openTaskCount: number;
  commentCount: number;
};

export type UserCreateInput = {
  name: string;
  email: string;
};

export type UserUpdateResult = { status: "ok" } | { status: "missing" };

export type UserDeleteResult =
  | { status: "ok" }
  | { status: "missing" }
  | { status: "restricted"; message: string };

export interface UsersModel {
  /**
   * The workspace members with their aggregate counts, ordered by
   * `display_name DESC, id DESC`. An empty `term` returns every member.
   */
  list(term: string): Promise<User[]>;

  /**
   * One member by id, or null when no row matches. Returns the same shape
   * `list` does so the list and the detail header cannot disagree about the
   * aggregate counts.
   */
  get(id: number): Promise<User | null>;

  /**
   * The tasks assigned to one member, ordered `updated_at DESC, id DESC`,
   * with the shared task projection (src/lib/task-projection.ts).
   */
  listTasks(assigneeId: number): Promise<Task[]>;

  /** Inserts one member and returns its id. */
  create(input: UserCreateInput): Promise<{ id: number }>;

  /** Updates one member by primary key. */
  update(id: number, input: UserCreateInput): Promise<UserUpdateResult>;

  /**
   * Deletes one member. `restricted` carries the reference's guard message:
   * comments.author_id is ON DELETE RESTRICT, so a member who has written
   * anything cannot be removed. tasks.assignee_id is ON DELETE SET NULL,
   * which unassigns rather than blocking, so only comments stop a delete.
   */
  remove(id: number): Promise<UserDeleteResult>;
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

    async get(id) {
      try {
        const [user] = await db<User[]>`
          ${USER_AGGREGATES}
          WHERE u.id = ${id}
          GROUP BY u.id, u.display_name, u.email
        `;

        return user ?? null;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch the user.");
      }
    },

    async listTasks(assigneeId) {
      try {
        return await db<Task[]>`
          SELECT
            ${taskProjectionFields(db)}
          ${taskProjectionFrom(db)}
          WHERE t.assignee_id = ${assigneeId}
          GROUP BY t.id, p.name, u.display_name
          ORDER BY t.updated_at DESC, t.id DESC
        `;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch the user's tasks.");
      }
    },

    async create(input) {
      try {
        // RETURNING id so the client can go to the row that was just created
        // (the contract redirects a create to the new member's page).
        const [row] = await db<{ id: number }[]>`
          INSERT INTO users (display_name, email)
          VALUES (${input.name}, ${input.email})
          RETURNING id::int AS id
        `;

        return { id: row.id };
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to create the user.");
      }
    },

    async update(id, input) {
      try {
        // RETURNING distinguishes "no such row" from "row updated", so a
        // stale form cannot report success for a member who is already gone.
        const updated = await db<{ id: number }[]>`
          UPDATE users
          SET display_name = ${input.name}, email = ${input.email}
          WHERE id = ${id}
          RETURNING id
        `;

        if (updated.length === 0) {
          return { status: "missing" };
        }

        return { status: "ok" };
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to update the user.");
      }
    },

    async remove(id) {
      try {
        const deleted = await db<{ id: number }[]>`
          DELETE FROM users WHERE id = ${id} RETURNING id
        `;

        if (deleted.length === 0) {
          return { status: "missing" };
        }

        return { status: "ok" };
      } catch (error) {
        // comments.author_id is ON DELETE RESTRICT, so a member who has
        // written anything cannot be removed. tasks.assignee_id is ON DELETE
        // SET NULL, which unassigns rather than blocking, so only comments
        // stop a delete. 23001 is restrict_violation; 23503 is what NO ACTION
        // raises, and both mean the same thing here.
        const code = (error as { code?: string }).code;

        if (code === "23001" || code === "23503") {
          const [commentRow] = await db<{ count: number }[]>`
            SELECT COUNT(*)::int AS count FROM comments WHERE author_id = ${id}
          `;
          const [taskRow] = await db<{ count: number }[]>`
            SELECT COUNT(*)::int AS count FROM tasks WHERE assignee_id = ${id}
          `;

          const commentCount = commentRow?.count ?? 0;
          const taskCount = taskRow?.count ?? 0;

          // The counts are named separately because the two FKs mean different
          // things, and only one of them is what blocks the delete:
          //   comments.author_id  ON DELETE RESTRICT — the delete is refused,
          //                                         and this is why
          //   tasks.assignee_id   ON DELETE SET NULL  — the delete succeeds and
          //                                         the tasks become unassigned
          // Naming both makes the message actionable: the reader learns which
          // rows to deal with, and that the task count is context rather than a
          // second blocker.
          return {
            status: "restricted",
            message:
              `This person still has ${commentCount} ` +
              `${commentCount === 1 ? "comment" : "comments"} and ${taskCount} ` +
              `${taskCount === 1 ? "task" : "tasks"}. Remove ` +
              `${commentCount === 1 ? "the comment" : "the comments"} before deleting.`,
          };
        }

        console.error("Database Error:", error);
        throw new Error("Failed to delete the user.");
      }
    },
  };
}
