// src/tasks/tasks.model.ts
//
// The model layer for tasks: the only place that knows the tasks SQL. Mirrors
// the reference variant's reads (apps/tanstack-start-react/src/lib/data.ts —
// getTasks, getTask, getComments, countTasks, getUserTasks) and writes
// (actions.ts — createTask, updateTask, deleteTask, createTaskWithComment,
// createComment, resolveRefs) statement for statement, so both apps return
// identical rows and make identical changes for the same database.
//
// The task row is the shared projection every surface that renders a task uses
// (src/lib/task-projection.ts): the project name from its join, the assignee
// name COALESCEed for unassigned tasks, and the comment count aggregated here
// so a listing needs no second query. A task's stored status reaches the client
// untranslated — the stored values are the contract.
//
// Comments live in this domain: they are a sub-resource of a task
// (comments.task_id), and every comment read/write here is scoped by one.

import type { Db } from "../db/connection.ts";
import { decodeCursor, encodeCursor } from "../lib/cursor.ts";
import {
  taskCreatedAtCursorField,
  taskProjectionFields,
  taskProjectionFrom,
  taskUpdatedAtCursorField,
} from "../lib/task-projection.ts";
import type { ProjectTaskFilters, TaskListFilters } from "./tasks.validator.ts";

/** spec/queries.md — a task list page carries at most 25 rows. */
const PAGE_SIZE = 25;

/** spec/queries.md — a task detail shows the 10 most recent comments. */
const COMMENTS_PER_TASK = 10;

export type TaskStatus = "todo" | "in progress" | "done";

/** A task joined with its project name, as the workspace list renders it. */
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

/** A workspace-list row: the task plus the raw `(updated_at, id)` cursor parts. */
export type TaskRow = Task & {
  /** Raw `updated_at` at microsecond precision, the cursor's time component. */
  updatedAtRaw: string;
  /** The `(updated_at, id)` tuple the next page starts after. */
  cursorFor: string;
};

/** A project-board row: the board pages over `(created_at, id)` instead. */
export type ProjectTaskRow = Task & {
  createdAtRaw: string;
  cursorFor: string;
};

export type Comment = {
  id: number;
  taskId: number;
  authorName: string;
  body: string;
  createdAt: string;
};

/** Field errors the reference's resolveRefs produces, keyed by body field. */
export type TaskRefErrors = {
  projectId?: string[];
  assigneeId?: string[];
};

export type TaskCreateInput = {
  projectId: number;
  assigneeId: number | null;
  title: string;
  description: string;
  status: string;
};

export type TaskUpdateInput = {
  title: string;
  description: string;
  status: string;
  assigneeId: number | null;
};

export type WithCommentInput = TaskCreateInput & {
  commentBody: string;
  commentAuthorId: number;
};

export type TaskUpdateResult =
  { status: "ok" } | { status: "missing" } | { status: "assignee-missing" };

export type AddCommentResult =
  { status: "ok" } | { status: "task-missing" } | { status: "author-missing" };

export interface TasksModel {
  /**
   * The workspace-wide task list, ordered by `updated_at DESC, id DESC`, one
   * keyset page of at most `limit` rows (clamped to [1, 26], default 25).
   */
  list(filters: TaskListFilters): Promise<TaskRow[]>;

  /** One task by id with its project and assignee names, or null. */
  get(id: number): Promise<Task | null>;

  /**
   * One page of a project's tasks, newest first: ordered
   * `created_at DESC, id DESC`, keyset-paged, at most `limit` rows
   * (clamped to [1, 26], default 25).
   */
  listByProject(
    projectId: number,
    filters: ProjectTaskFilters,
  ): Promise<ProjectTaskRow[]>;

  /**
   * The tasks assigned to one member, ordered `updated_at DESC, id DESC`.
   * Scoped by `assignee_id` rather than a name: two members can share a
   * display name, and a name filter would hand each of them the other's work.
   */
  listByAssignee(assigneeId: number): Promise<Task[]>;

  /** The 10 most recent comments on one task, newest first. */
  listComments(taskId: number): Promise<Comment[]>;

  /**
   * Counts the tasks matching the workspace list's filters. A second statement
   * rather than a window function, deliberately: the list is `LIMIT`ed, and
   * `COUNT(*) OVER ()` would force Postgres to materialise every matching row
   * before discarding all but the first page.
   */
  count(filters: TaskListFilters): Promise<number>;

  /**
   * The database half of the reference's resolveRefs: whether the ids that
   * passed shape validation name real rows. Returns field errors so an
   * unknown id lands on its field like any other validation failure.
   */
  resolveRefs(
    projectId: number,
    assigneeId: number | null,
  ): Promise<{ errors: TaskRefErrors }>;

  /** Inserts one task (created_at/updated_at set equal) and returns its id. */
  create(input: TaskCreateInput): Promise<{ id: number }>;

  /** Updates one task by primary key, explicitly advancing `updated_at`. */
  update(id: number, input: TaskUpdateInput): Promise<TaskUpdateResult>;

  /**
   * Deletes one task under the documented cascade and reports the project the
   * contract redirects the client to. Null when no such row exists.
   */
  remove(id: number): Promise<{ projectId: number } | null>;

  /**
   * spec/queries.md — "Create with initial comment": ONE transaction inserting
   * the task then its comment, any failure rolling back both. Checks the
   * comment author first so an unknown id is a field error rather than a
   * thrown FK violation.
   */
  createWithComment(
    input: WithCommentInput,
  ): Promise<{ status: "ok"; id: number } | { status: "author-missing" }>;

  /** Adds one comment to an existing task. */
  addComment(
    taskId: number,
    input: { body: string; authorId: number },
  ): Promise<AddCommentResult>;
}

// ILIKE treats %, _ and \ as wildcards, so a search for "100%" must not match
// every row — the term is escaped before it reaches the pattern.
const escapeLike = (term: string) => term.replace(/[\\%_]/g, "\\$&");

export function createTasksModel(db: Db): TasksModel {
  return {
    async list(filters) {
      const {
        search = "",
        status = "",
        projectId,
        assigneeId,
        cursor = null,
        limit = PAGE_SIZE,
      } = filters;
      const term = search.trim();

      // LIKE wildcards in a search box are almost always a literal character
      // the user typed, not a pattern. Without escaping, a single `%` matches
      // every row and hides a real filtering bug.
      const searchFilter = term
        ? db`AND (t.title ILIKE ${`%${escapeLike(term)}%`}
              OR t.description ILIKE ${`%${escapeLike(term)}%`})`
        : db``;

      const decoded = decodeCursor(cursor);

      // Keyset rather than OFFSET: OFFSET re-walks every skipped row, so page
      // 50 costs 50x page 1, and a row inserted mid-walk shifts the window.
      // The cursor is bound as text and cast in SQL rather than as a
      // timestamptz: the driver would otherwise try to parse it back into a
      // Date, which turns a stale or hand-edited cursor into a driver-level
      // error instead of simply not matching a row.
      const cursorFilter = decoded
        ? db`AND (t.updated_at, t.id) < (${decoded.createdAt}::text::timestamptz, ${decoded.id})`
        : db``;

      // Clamped so a caller cannot ask for an unbounded page. One row above
      // the page size is allowed deliberately: fetching PAGE + 1 and dropping
      // the last is how the caller learns whether an older page exists without
      // a COUNT.
      const bound = Math.max(1, Math.min(limit, PAGE_SIZE + 1));

      try {
        const rows = await db<TaskRow[]>`
          SELECT
            ${taskProjectionFields(db)},
            ${taskUpdatedAtCursorField(db)}
          ${taskProjectionFrom(db)}
          WHERE 1 = 1
          ${projectId === undefined ? db`` : db`AND t.project_id = ${projectId}`}
          ${status ? db`AND t.status = ${status}` : db``}
          ${assigneeId === undefined ? db`` : db`AND t.assignee_id = ${assigneeId}`}
          ${searchFilter}
          ${cursorFilter}
          GROUP BY t.id, p.name, u.display_name, t.updated_at
          ORDER BY t.updated_at DESC, t.id DESC
          LIMIT ${bound}
        `;

        // Derived here rather than in SQL so cursor packing has one
        // implementation, shared with the decoder this query reads a page back
        // with.
        return rows.map((row) => ({
          ...row,
          cursorFor: encodeCursor(row.updatedAtRaw, row.id),
        }));
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch tasks.");
      }
    },

    async get(id) {
      try {
        const [task] = await db<Task[]>`
          SELECT
            ${taskProjectionFields(db)}
          ${taskProjectionFrom(db)}
          WHERE t.id = ${id}
          GROUP BY t.id, p.name, u.display_name
        `;

        return task ?? null;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch the task.");
      }
    },

    async listByProject(projectId, filters) {
      const { status = "", cursor = null, limit = PAGE_SIZE } = filters;

      const statusFilter = status ? db`AND t.status = ${status}` : db``;

      const decoded = decodeCursor(cursor);

      // The board pages over `(created_at, id)`: the board is "newest first"
      // by when work appeared, not by when it last moved. Comparing the row
      // tuple in one predicate lets Postgres use tasks_project_created_id_idx
      // directly.
      const cursorFilter = decoded
        ? db`AND (t.created_at, t.id) < (${decoded.createdAt}::text::timestamptz, ${decoded.id})`
        : db``;

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

    async listByAssignee(assigneeId) {
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

    async listComments(taskId) {
      try {
        return await db<Comment[]>`
          SELECT
            c.id::int AS id,
            c.task_id::int AS "taskId",
            u.display_name AS "authorName",
            c.body,
            to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
          FROM comments c
          JOIN users u ON u.id = c.author_id
          WHERE c.task_id = ${taskId}
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT ${COMMENTS_PER_TASK}
        `;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to fetch the task comments.");
      }
    },

    async count(filters) {
      const { search = "", status = "", projectId, assigneeId } = filters;
      const term = search.trim();

      const searchFilter = term
        ? db`AND (t.title ILIKE ${`%${escapeLike(term)}%`}
              OR t.description ILIKE ${`%${escapeLike(term)}%`})`
        : db``;

      try {
        const [row] = await db<{ count: number }[]>`
          SELECT COUNT(*)::int AS count
          FROM tasks t
          WHERE 1 = 1
          ${projectId === undefined ? db`` : db`AND t.project_id = ${projectId}`}
          ${status ? db`AND t.status = ${status}` : db``}
          ${assigneeId === undefined ? db`` : db`AND t.assignee_id = ${assigneeId}`}
          ${searchFilter}
        `;

        return row?.count ?? 0;
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to count tasks.");
      }
    },

    async resolveRefs(projectId, assigneeId) {
      const errors: TaskRefErrors = {};

      const [project] = await db<{ id: number }[]>`
        SELECT id::int FROM projects WHERE id = ${projectId}
      `;

      if (!project) {
        errors.projectId = ["That project no longer exists."];
      }

      if (assigneeId !== null) {
        const [assignee] = await db<{ id: number }[]>`
          SELECT id::int FROM users WHERE id = ${assigneeId}
        `;

        if (!assignee) {
          errors.assigneeId = ["That assignee no longer exists."];
        }
      }

      return { errors };
    },

    async create(input) {
      try {
        // spec/queries.md — the server sets `created_at` and `updated_at`
        // explicitly and equal (now() is the transaction timestamp, so both
        // calls in one statement return the same instant). RETURNING id so the
        // client can go to the row that was just created.
        const [row] = await db<{ id: number }[]>`
          INSERT INTO tasks (
            project_id, assignee_id, title, description, status, created_at, updated_at
          )
          VALUES (
            ${input.projectId}, ${input.assigneeId}, ${input.title}, ${input.description}, ${input.status}, now(), now()
          )
          RETURNING id::int AS id
        `;

        return { id: row.id };
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to create the task.");
      }
    },

    async update(id, input) {
      // The assignee is checked first, mirroring the reference: a bad assignee
      // is a field error (the client can fix it), a missing task is a 404, and
      // the field error is the more actionable of the two to report first.
      if (input.assigneeId !== null) {
        const [assignee] = await db<{ id: number }[]>`
          SELECT id::int FROM users WHERE id = ${input.assigneeId}
        `;

        if (!assignee) {
          return { status: "assignee-missing" };
        }
      }

      // Read the row first so a missing task is reported before anything is
      // written, exactly as the reference does.
      const [existing] = await db<{ id: number }[]>`
        SELECT id::int FROM tasks WHERE id = ${id}
      `;

      if (!existing) {
        return { status: "missing" };
      }

      try {
        // spec/queries.md — `updated_at` is set in the statement, not by a DB
        // default or an ORM side effect. RETURNING distinguishes "no such row"
        // from "row updated" if the row is deleted between the read above and
        // this write.
        const updated = await db<{ id: number }[]>`
          UPDATE tasks
          SET
            title = ${input.title},
            description = ${input.description},
            status = ${input.status},
            assignee_id = ${input.assigneeId},
            updated_at = now()
          WHERE id = ${id}
          RETURNING id
        `;

        if (updated.length === 0) {
          return { status: "missing" };
        }

        return { status: "ok" };
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to update the task.");
      }
    },

    async remove(id) {
      // Read the project first, because the contract redirects to its board
      // after a delete; a missing task is reported before anything is written.
      const [existing] = await db<{ projectId: number }[]>`
        SELECT project_id::int AS "projectId" FROM tasks WHERE id = ${id}
      `;

      if (!existing) {
        return null;
      }

      try {
        const deleted = await db<{ id: number }[]>`
          DELETE FROM tasks WHERE id = ${id} RETURNING id
        `;

        if (deleted.length === 0) {
          return null;
        }

        return { projectId: existing.projectId };
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to delete the task.");
      }
    },

    async createWithComment(input) {
      // The author is a FK like the assignee, so an id that matches no row
      // fails the insert. Checking first turns that into a field error rather
      // than a thrown Postgres error the user cannot act on.
      const [author] = await db<{ id: number }[]>`
        SELECT id::int FROM users WHERE id = ${input.commentAuthorId}
      `;

      if (!author) {
        return { status: "author-missing" };
      }

      try {
        // db is the postgres.js connection, and `begin` is its transaction
        // API (src/db/connection.ts hands every model the same instance). The
        // task insert and the comment insert share one transaction: a failure
        // in either throws and rolls back both, which is what
        // spec/queries.md means by "no partial state is ever observable".
        return await db.begin(async (tx) => {
          const [row] = await tx<{ id: number }[]>`
            INSERT INTO tasks (
              project_id, assignee_id, title, description, status, created_at, updated_at
            )
            VALUES (
              ${input.projectId}, ${input.assigneeId}, ${input.title}, ${input.description}, ${input.status}, now(), now()
            )
            RETURNING id::int AS id
          `;

          // Inside the same transaction, so a failure here throws and the
          // task insert above is rolled back with it.
          await tx`
            INSERT INTO comments (task_id, author_id, body, created_at)
            VALUES (${row.id}, ${input.commentAuthorId}, ${input.commentBody}, now())
          `;

          return { status: "ok" as const, id: row.id };
        });
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to create the task.");
      }
    },

    async addComment(taskId, input) {
      // The task and the author are both foreign keys. Checking first turns
      // an unknown id into an outcome the client can act on, rather than a
      // thrown Postgres error.
      const [[task], [author]] = await Promise.all([
        db<{ id: number }[]>`SELECT id::int FROM tasks WHERE id = ${taskId}`,
        db<{ id: number }[]>`
          SELECT id::int FROM users WHERE id = ${input.authorId}
        `,
      ]);

      if (!task) {
        return { status: "task-missing" };
      }

      if (!author) {
        return { status: "author-missing" };
      }

      try {
        await db`
          INSERT INTO comments (task_id, author_id, body, created_at)
          VALUES (${taskId}, ${input.authorId}, ${input.body}, now())
        `;

        return { status: "ok" };
      } catch (error) {
        console.error("Database Error:", error);
        throw new Error("Failed to add the comment.");
      }
    },
  };
}
