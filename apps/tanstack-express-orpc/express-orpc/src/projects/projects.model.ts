// src/projects/projects.model.ts
//
// The model layer for projects: the only place that knows the projects SQL.
// Mirrors the reference variant (apps/tanstack-start-react/src/lib/data.ts —
// getProjects, getProject, getProjectTasks; actions.ts — createProject,
// updateProject, deleteProject) statement for statement, so both apps return
// identical rows and make identical changes for the same database.
//
// The project task board (GET /api/projects/:id/tasks) is served here because
// it is this surface's read: the task-row projection it returns is the shared
// one (src/lib/task-projection.ts), so a board row cannot drift from the
// workspace list's row for the same task.

import type { Db } from "../db/connection.ts";
import { decodeCursor, encodeCursor } from "../lib/cursor.ts";
import {
  taskCreatedAtCursorField,
  taskProjectionFields,
  taskProjectionFrom,
} from "../lib/task-projection.ts";
import type { ProjectTaskFilters } from "../tasks/tasks.validator.ts";
import type { ProjectTaskRow } from "../tasks/tasks.model.ts";

/** spec/queries.md — a board page carries at most 25 rows. */
const PAGE_SIZE = 25;

export type Project = {
  id: number;
  name: string;
  description: string;
  taskCount: number;
  openTaskCount: number;
  peopleCount: number;
  createdAt: string;
};

export type ProjectCreateInput = {
  name: string;
  description: string;
};

export type ProjectUpdateResult =
  | { status: "ok" }
  | { status: "missing" };

export type ProjectDeleteResult =
  | { status: "ok" }
  | { status: "missing" }
  | { status: "restricted"; message: string };

export interface ProjectsModel {
  /**
   * Every project with its aggregate counts, ordered
   * `created_at DESC, id DESC`. An empty `term` returns every project.
   */
  list(term: string): Promise<Project[]>;

  /** One project by id, with the same shape `list` returns, or null. */
  get(id: number): Promise<Project | null>;

  /**
   * One page of a project's task board, newest first
   * (`created_at DESC, id DESC`), keyset-paged over `(created_at, id)`, at
   * most `limit` rows (clamped to [1, 26], default 25).
   */
  listTasks(
    projectId: number,
    filters: ProjectTaskFilters,
  ): Promise<ProjectTaskRow[]>;

  /** Inserts one project (`created_at` set by the server) and returns its id. */
  create(input: ProjectCreateInput): Promise<{ id: number }>;

  /** Updates one project by primary key. */
  update(id: number, input: ProjectCreateInput): Promise<ProjectUpdateResult>;

  /**
   * Deletes one project. `restricted` carries the reference's guard message:
   * tasks.project_id is ON DELETE RESTRICT, so a project that still has tasks
   * cannot be removed.
   */
  remove(id: number): Promise<ProjectDeleteResult>;
}

// ILIKE treats %, _ and \ as wildcards, so a search for "100%" must not match
// every row — the term is escaped before it reaches the pattern.
const escapeLike = (term: string) => term.replace(/[\\%_]/g, "\\$&");

export function createProjectsModel(db: Db): ProjectsModel {
  // The project projection, with the aggregate columns the listing table
  // renders. COUNT(DISTINCT t.assignee_id) is DISTINCT because a project with
  // several tasks by the same member still has exactly one member.
  const PROJECT_FIELDS = db`
    p.id::int AS id,
    p.name,
    p.description,
    COUNT(t.id)::int AS "taskCount",
    COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
    COUNT(DISTINCT t.assignee_id)::int AS "peopleCount",
    (p.created_at AT TIME ZONE 'UTC')::date::text AS "createdAt"
  `;
  const PROJECT_FROM = db`
    FROM projects p
    LEFT JOIN tasks t ON p.id = t.project_id
  `;

  return {
    async list(term) {
      const where = term
        ? db`WHERE p.name ILIKE ${`%${escapeLike(term)}%`}
              OR p.description ILIKE ${`%${escapeLike(term)}%`}`
        : db``;

      try {
        return await db<Project[]>`
          SELECT
            ${PROJECT_FIELDS}
          ${PROJECT_FROM}
          ${where}
          GROUP BY p.id, p.name, p.description, p.created_at
          ORDER BY p.created_at DESC, p.id DESC
        `;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch projects.");
      }
    },

    async get(id) {
      try {
        const [project] = await db<Project[]>`
          SELECT
            ${PROJECT_FIELDS}
          ${PROJECT_FROM}
          WHERE p.id = ${id}
          GROUP BY p.id, p.name, p.description, p.created_at
        `;

        return project ?? null;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch the project.");
      }
    },

    async listTasks(projectId, filters) {
      const { status = "", cursor = null, limit = PAGE_SIZE } = filters;

      const statusFilter = status ? db`AND t.status = ${status}` : db``;

      const decoded = decodeCursor(cursor);

      // Keyset rather than OFFSET: OFFSET re-walks every skipped row, so page
      // 50 costs 50x page 1, and a row inserted mid-walk shifts the window.
      // Comparing the row tuple in one predicate lets Postgres use
      // tasks_project_created_id_idx directly. Bound as text and cast in SQL
      // rather than as a timestamptz so an unusable cursor matches nothing
      // instead of failing in the driver.
      const cursorFilter = decoded
        ? db`AND (t.created_at, t.id) < (${decoded.createdAt}::text::timestamptz, ${decoded.id})`
        : db``;

      // Clamped so a caller cannot ask for an unbounded page. One row above
      // the page size is allowed deliberately: fetching PAGE + 1 and dropping
      // the last is how the caller learns whether an older page exists
      // without a COUNT.
      const bound = Math.max(1, Math.min(limit, PAGE_SIZE + 1));

      try {
        const rows = await db<ProjectTaskRow[]>`
          SELECT
            ${taskProjectionFields(db)},
            ${taskCreatedAtCursorField(db)}
          ${taskProjectionFrom(db)}
          WHERE t.project_id = ${projectId}
          ${statusFilter}
          ${cursorFilter}
          GROUP BY t.id, p.name, u.display_name, t.created_at
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT ${bound}
        `;

        return rows.map((row) => ({
          ...row,
          cursorFor: encodeCursor(row.createdAtRaw, row.id),
        }));
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch the project tasks.");
      }
    },

    async create(input) {
      try {
        // created_at is NOT NULL with no default, so the server sets it.
        // RETURNING id so the client can go to the row that was just created
        // (the contract redirects a create to the new project's board).
        const [row] = await db<{ id: number }[]>`
          INSERT INTO projects (name, description, created_at)
          VALUES (${input.name}, ${input.description}, now())
          RETURNING id::int AS id
        `;

        return { id: row.id };
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to create the project.");
      }
    },

    async update(id, input) {
      try {
        // RETURNING distinguishes "no such row" from "row updated", so a
        // stale form cannot report success for a project that is already gone.
        const updated = await db<{ id: number }[]>`
          UPDATE projects
          SET name = ${input.name}, description = ${input.description}
          WHERE id = ${id}
          RETURNING id
        `;

        if (updated.length === 0) {
          return { status: "missing" };
        }

        return { status: "ok" };
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to update the project.");
      }
    },

    async remove(id) {
      try {
        const deleted = await db<{ id: number }[]>`
          DELETE FROM projects WHERE id = ${id} RETURNING id
        `;

        if (deleted.length === 0) {
          return { status: "missing" };
        }

        return { status: "ok" };
      } catch (error) {
        // tasks.project_id is ON DELETE RESTRICT, so a project that still has
        // tasks cannot be removed. 23001 is restrict_violation; 23503 is what
        // NO ACTION raises, and both mean the same thing here. This is a rule
        // the user can act on, so it is reported rather than thrown.
        const code = (error as { code?: string }).code;

        if (code === "23001" || code === "23503") {
          const [row] = await db<{ count: number }[]>`
            SELECT COUNT(*)::int AS count FROM tasks WHERE project_id = ${id}
          `;

          const count = row?.count ?? 0;

          return {
            status: "restricted",
            message:
              count === 1
                ? "This project still has 1 task. Delete it before deleting the project."
                : `This project still has ${count} tasks. Delete them before deleting the project.`,
          };
        }

        console.error("Database Error:", error);
        throw new Error("Failed to delete the project.");
      }
    },
  };
}
