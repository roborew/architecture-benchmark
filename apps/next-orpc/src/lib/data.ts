import type {
  Comment,
  DashboardProject,
  DashboardStats,
  DashboardTask,
  Project,
  ProjectTaskRow,
  TaskStatus,
  TaskWithProject,
  User,
} from "@/lib/types";
import type { ActionResult } from "./result";
import { fieldErrors } from "./result";
import { z } from "zod";

import { decodeCursor, encodeCursor } from "./cursor";
import { sql } from "./db";

// This module is the only place that talks to Postgres. Reads (`get*`) throw on
// failure, because a page that cannot load is a broken page. Writes (`create*`,
// `update*`, `delete*`) return an `ActionResult` instead, because a refused write
// is usually ordinary user error the form has to render — see lib/result.ts.
//
// Every write keeps its own `try`/`catch` and never rethrows, so a caller cannot
// forget to handle a fault and so the user-visible message lives beside the
// statement that can actually produce it.

const escapeLike = (term: string) => term.replace(/[\\%_]/g, "\\$&");

/**
 * spec/queries.md — "List project tasks" returns up to 25 rows, newest first.
 * `PAGE_SIZE` is that bound; it is also the default `limit`, so a page cannot
 * silently grow past the contract.
 */
const PAGE_SIZE = 25;

const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in progress", "done"];

/** spec/queries.md — a task detail shows the 10 most recent comments. */
const COMMENTS_PER_TASK = 10;

/** How many rows each dashboard section shows. */
const DASHBOARD_RECENT_TASKS = 3;
const DASHBOARD_PROJECTS = 2;

/**
 * Rendering notes for every timestamp below.
 *
 * Left alone, postgres.js renders a `timestamptz` in the *server's* zone, so
 * one row reads `2026-09-29 09:00:00+01` on a machine west of UTC. Every
 * timestamp in the schema is UTC (spec/schema.sql) and the fixtures store the
 * ISO-Z form, so a screen rendering a local-time string would show a different
 * instant than the database holds — and a different one per machine. Each
 * projection therefore pins the zone in SQL rather than relying on the driver.
 *
 * Timestamps are rendered to whole seconds because that is the fixture
 * precision; a sub-second component would make an integration assertion fail on
 * a value the fixture never claimed to carry.
 */

/**
 * The aggregate projection shared by `getUsers` and `getUser`.
 *
 * The counts are correlated subqueries, not LEFT JOIN aggregates: joining
 * tasks x comments multiplies rows, and a COUNT(DISTINCT) over that product
 * costs each member's tasks x comments — on the large fixture ~40M rows per
 * request, enough to stall every page that renders a member select. Each
 * subquery walks one index (tasks_assignee_id_idx, comments_author_id_idx),
 * so the cost stays linear in the members listed, not in the data.
 */
const USER_AGGREGATES = sql`
  SELECT
    u.id::int AS id,
    u.display_name AS name,
    u.email,
    (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id)::int AS "assignedTaskCount",
    (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status <> 'done')::int AS "openTaskCount",
    (SELECT COUNT(*) FROM comments c WHERE c.author_id = u.id)::int AS "commentCount"
  FROM users u
`;

/**
 * The task columns every read returns.
 *
 * Split from the `FROM` clause so a query that needs one extra column — the
 * keyset cursor — can add it without restating the shared ones.
 */
const TASK_PROJECTION_FIELDS = sql`
    t.id::int AS id,
    t.project_id::int AS "projectId",
    p.name AS "projectName",
    t.title,
    t.description,
    t.status,
    -- The id as well as the name: the edit form has to prefill the assignee
    -- select, and a display name cannot round-trip a select that holds ids.
    -- users.display_name is not unique either, so two members can share one.
    t.assignee_id::int AS "assigneeId",
    COALESCE(u.display_name, 'Unassigned') AS "assigneeName",
    COUNT(c.id)::int AS "commentCount",
    to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
`;

/**
 * The raw `(updated_at, id)` components a keyset cursor is built from.
 *
 * Appended only by the paged queries. `getTask` fetches a single row by
 * primary key and has no cursor to build, so it must not carry this.
 */
const CURSOR_FIELD = sql`
    to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS "updatedAtRaw"
`;

/** The `FROM`/`JOIN` clause every task read shares, so the joins cannot drift. */
const TASK_PROJECTION_FROM = sql`
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN users u ON u.id = t.assignee_id
  LEFT JOIN comments c ON c.task_id = t.id
`;

/**
 * The task row projection shared by every task read.
 *
 * Declared once because the same task is rendered by three pages; a projection
 * that drifted between them would show one task with two different statuses.
 * `COALESCE` covers the nullable `assignee_id`, and `commentCount` uses COUNT
 * over the LEFT JOIN rather than a subquery so it costs nothing extra on the
 * bounded page.
 */
const TASK_PROJECTION = sql`
  SELECT
    ${TASK_PROJECTION_FIELDS}
  ${TASK_PROJECTION_FROM}
`;

export async function getProjects(value = "") {
  const term = value.trim();
  const where = term
    ? sql`WHERE p.name ILIKE ${`%${escapeLike(term)}%`}
          OR p.description ILIKE ${`%${escapeLike(term)}%`}`
    : sql``;

  try {
    return await sql<Project[]>`
      SELECT
        p.id::int AS id,
        p.name,
        p.description,
        COUNT(t.id)::int AS "taskCount",
        COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
        COUNT(DISTINCT t.assignee_id)::int AS "peopleCount",
        (p.created_at AT TIME ZONE 'UTC')::date::text AS "createdAt"
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id
      ${where}
      GROUP BY p.id, p.name, p.description, p.created_at
      ORDER BY p.created_at DESC, p.id DESC
    `;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch projects.");
  }
}

/**
 * A single project by id, or `null` when no row matches. The edit form needs
 * the stored values to prefill its fields, so this returns the same shape
 * `getProjects` does rather than the raw row.
 */
export async function getProject(id: number): Promise<Project | null> {
  try {
    const [project] = await sql<Project[]>`
      SELECT
        p.id::int AS id,
        p.name,
        p.description,
        COUNT(t.id)::int AS "taskCount",
        COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
        COUNT(DISTINCT t.assignee_id)::int AS "peopleCount",
        (p.created_at AT TIME ZONE 'UTC')::date::text AS "createdAt"
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id
      WHERE p.id = ${id}
      GROUP BY p.id, p.name, p.description, p.created_at
    `;

    return project ?? null;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch the project.");
  }
}

export type ProjectTaskFilters = {
  /** A single status, or empty/absent for every status. */
  status?: string;
  /** Opaque keyset cursor for `(created_at, id)`; absent means the first page. */
  cursor?: string | null;
  limit?: number;
};

/**
 * One page of a project's tasks, newest first, with the assignee name and the
 * comment count the table renders.
 *
 * spec/queries.md fixes the shape: `tasks` driving, LEFT JOIN `users` on the
 * nullable `assignee_id`, ordered `(created_at DESC, id DESC)` and `LIMIT`ed.
 * `id` is the tiebreaker because fixture timestamps are unique but a live
 * insert can share one, and an unstable order would make a keyset page skip or
 * repeat a row.
 */
export async function getProjectTasks(
  projectId: number,
  { status = "", cursor = null, limit = PAGE_SIZE }: ProjectTaskFilters = {},
): Promise<ProjectTaskRow[]> {
  const term = status.trim();

  // `status` is constrained text in the schema. Validating here rather than
  // letting the constraint reject it turns a tampered URL into a clear error
  // instead of a raw Postgres check-constraint message.
  if (term && !TASK_STATUSES.includes(term as TaskStatus)) {
    throw new Error(`Unknown task status: ${term}`);
  }

  const statusFilter = term ? sql`AND t.status = ${term}` : sql``;

  const decoded = decodeCursor(cursor);

  // Keyset rather than OFFSET: OFFSET re-walks every skipped row, so page 50
  // costs 50x page 1, and a row inserted mid-walk shifts the window. Comparing
  // the row tuple in one predicate lets Postgres use
  // tasks_project_created_id_idx directly.
  //
  // The cursor is bound as text and cast in SQL rather than as a timestamptz:
  // the driver would otherwise try to parse it back into a Date, which turns a
  // stale or hand-edited cursor into a driver-level error instead of simply
  // not matching a row.
  const cursorFilter = decoded
    ? sql`AND (t.created_at, t.id) < (${decoded.createdAt}::text::timestamptz, ${decoded.id})`
    : sql``;

  // Clamped so a caller cannot ask for an unbounded page. One row above the page
  // size is allowed deliberately: fetching PAGE + 1 and dropping the last is
  // how the caller learns whether an older page exists without a COUNT.
  const bound = Math.max(1, Math.min(limit, PAGE_SIZE + 1));

  try {
    const rows = await sql<ProjectTaskRow[]>`
      SELECT
        ${TASK_PROJECTION_FIELDS},
        -- The cursor needs microsecond precision, and a Z suffix since the
        -- value is already in UTC.
        to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS "createdAtRaw"
      ${TASK_PROJECTION_FROM}
      WHERE t.project_id = ${projectId}
      ${statusFilter}
      ${cursorFilter}
      GROUP BY t.id, p.name, u.display_name, t.created_at
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${bound}
    `;

    // Derived here rather than in SQL so cursor packing has one implementation,
    // shared with the decoder this query uses to read a page back.
    return rows.map((row) => ({
      ...row,
      cursorFor: encodeCursor(row.createdAtRaw, row.id),
    }));
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch the project tasks.");
  }
}

export type TaskRow = TaskWithProject & {
  /** Raw `updated_at` at microsecond precision, the cursor's time component. */
  updatedAtRaw: string;
  /** The `(updated_at, id)` tuple the next page starts after. */
  cursorFor: string;
};

export type TaskFilters = {
  projectId?: number;
  status?: string;
  assigneeId?: number;
  search?: string;
  limit?: number;
  /** Opaque keyset cursor for `(updated_at, id)`; absent means the first page. */
  cursor?: string | null;
};

/**
 * The workspace-wide task list, newest updated first.
 *
 * Shares its projection with `getProjectTasks` so a row cannot look different
 * depending on which page fetched it — the same task must render identically in
 * the project board, the workspace list and its detail page.
 */
export async function getTasks({
  projectId,
  status = "",
  assigneeId,
  search = "",
  limit = PAGE_SIZE,
  cursor = null,
}: TaskFilters = {}): Promise<TaskRow[]> {
  const statusTerm = status.trim();

  if (statusTerm && !TASK_STATUSES.includes(statusTerm as TaskStatus)) {
    throw new Error(`Unknown task status: ${statusTerm}`);
  }

  const term = search.trim();

  // LIKE wildcards in a search box are almost always a literal character the
  // user typed, not a pattern. Without escaping, a single `%` matches every
  // row and hides a real filtering bug.
  const searchFilter = term
    ? sql`AND (t.title ILIKE ${`%${escapeLike(term)}%`}
          OR t.description ILIKE ${`%${escapeLike(term)}%`})`
    : sql``;

  const decoded = decodeCursor(cursor);

  // Keyset rather than OFFSET: OFFSET re-walks every skipped row, so page 50
  // costs 50x page 1, and a row inserted mid-walk shifts the window. Bound as
  // text and cast in SQL so an unusable cursor matches nothing instead of
  // failing in the driver.
  const cursorFilter = decoded
    ? sql`AND (t.updated_at, t.id) < (${decoded.createdAt}::text::timestamptz, ${decoded.id})`
    : sql``;

  try {
    const rows = await sql<TaskRow[]>`
      SELECT
        ${TASK_PROJECTION_FIELDS},
        ${CURSOR_FIELD}
      ${TASK_PROJECTION_FROM}
      WHERE 1 = 1
      ${projectId === undefined ? sql`` : sql`AND t.project_id = ${projectId}`}
      ${statusTerm ? sql`AND t.status = ${statusTerm}` : sql``}
      ${assigneeId === undefined ? sql`` : sql`AND t.assignee_id = ${assigneeId}`}
      ${searchFilter}
      ${cursorFilter}
      GROUP BY t.id, p.name, u.display_name, t.updated_at
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT ${Math.max(1, Math.min(limit, PAGE_SIZE + 1))}
    `;

    return rows.map((row) => ({
      ...row,
      cursorFor: encodeCursor(row.updatedAtRaw, row.id),
    }));
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch tasks.");
  }
}

/**
 * One task by id, with the project and assignee names the detail page renders,
 * or `null` when no row matches.
 */
export async function getTask(id: number): Promise<TaskWithProject | null> {
  try {
    const [task] = await sql<TaskWithProject[]>`
      ${TASK_PROJECTION}
      WHERE t.id = ${id}
      GROUP BY t.id, p.name, u.display_name
    `;

    return task ?? null;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch the task.");
  }
}

/**
 * The most recent comments on one task, newest first.
 *
 * spec/queries.md caps this at 10: a task detail page must never load every
 * comment it has accumulated. `COMMENTS_PER_TASK` is that bound.
 */
export async function getComments(
  taskId: number,
  limit = COMMENTS_PER_TASK,
): Promise<Comment[]> {
  try {
    return await sql<Comment[]>`
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
      LIMIT ${Math.max(1, Math.min(limit, COMMENTS_PER_TASK))}
    `;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch the task comments.");
  }
}

/**
 * Counts the tasks matching the workspace list's filters.
 *
 * A second statement rather than a window function, deliberately: the list is
 * `LIMIT`ed, and `COUNT(*) OVER ()` would force Postgres to materialise every
 * matching row before discarding all but the first page. This way the page's
 * cost is one bounded read plus one aggregate.
 */
export async function countTasks({
  search = "",
  status = "",
  projectId,
  assigneeId,
}: TaskFilters = {}): Promise<number> {
  const statusTerm = status.trim();

  if (statusTerm && !TASK_STATUSES.includes(statusTerm as TaskStatus)) {
    throw new Error(`Unknown task status: ${statusTerm}`);
  }

  const term = search.trim();

  const searchFilter = term
    ? sql`AND (t.title ILIKE ${`%${escapeLike(term)}%`}
          OR t.description ILIKE ${`%${escapeLike(term)}%`})`
    : sql``;

  try {
    const [row] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM tasks t
      WHERE 1 = 1
      ${projectId === undefined ? sql`` : sql`AND t.project_id = ${projectId}`}
      ${statusTerm ? sql`AND t.status = ${statusTerm}` : sql``}
      ${assigneeId === undefined ? sql`` : sql`AND t.assignee_id = ${assigneeId}`}
      ${searchFilter}
    `;

    return row?.count ?? 0;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to count tasks.");
  }
}

/**
 * Workspace totals for the dashboard's stat cards.
 *
 * One statement rather than three, because the cards are rendered together and
 * separate COUNT queries would each scan a different table for the same row.
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const [stats] = await sql<DashboardStats[]>`
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
}

/**
 * The most recently updated tasks, for the dashboard's recent table.
 *
 * Ordered by `updated_at` rather than `created_at`: "recent activity" means
 * when the work last moved, which is also what `updateTask` advances.
 */
export async function getRecentTasks(
  limit = DASHBOARD_RECENT_TASKS,
): Promise<DashboardTask[]> {
  try {
    return await sql<DashboardTask[]>`
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
      LIMIT ${Math.max(1, Math.min(limit, DASHBOARD_RECENT_TASKS))}
    `;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch recent tasks.");
  }
}

/**
 * The busiest projects, for the dashboard's project cards.
 *
 * Ordered by task count so the cards answer "where is the work?" rather than
 * repeating the newest-first ordering of every other list.
 */
export async function getDashboardProjects(
  limit = DASHBOARD_PROJECTS,
): Promise<DashboardProject[]> {
  try {
    return await sql<DashboardProject[]>`
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
      LIMIT ${Math.max(1, Math.min(limit, DASHBOARD_PROJECTS))}
    `;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch dashboard projects.");
  }
}

export async function getUsers(value = "") {
  const term = value.trim();
  const where = term
    ? sql`WHERE u.display_name ILIKE ${`%${escapeLike(term)}%`}
          OR u.email ILIKE ${`%${escapeLike(term)}%`}`
    : sql``;

  try {
    return await sql<User[]>`
      ${USER_AGGREGATES}
      ${where}
      ORDER BY u.display_name DESC, u.id DESC
    `;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch users.");
  }
}

/**
 * A single member by id, or `null` when no row matches. Returns the same shape
 * `getUsers` does so the list and the detail header cannot disagree about the
 * aggregate counts.
 */
export async function getUser(id: number): Promise<User | null> {
  try {
    const [user] = await sql<User[]>`
      ${USER_AGGREGATES}
      WHERE u.id = ${id}
    `;

    return user ?? null;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch the user.");
  }
}

/**
 * The tasks assigned to one member, newest first.
 *
 * Scoped by `assignee_id` rather than filtered by display name: two members can
 * share a name (`users.display_name` has no UNIQUE constraint), and a name
 * filter would hand each of them the other's work.
 */
export async function getUserTasks(id: number): Promise<TaskWithProject[]> {
  try {
    return await sql<TaskWithProject[]>`
      ${TASK_PROJECTION}
      WHERE t.assignee_id = ${id}
      GROUP BY t.id, p.name, u.display_name
      ORDER BY t.updated_at DESC, t.id DESC
    `;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch the user's tasks.");
  }
}

// ---------------------------------------------------------------------------
// Writes
//
// From here on the module owns every statement that changes a row. The routers in
// src/orpc/routers/ are left as the transport: they check the input's shape and
// return whatever comes back here, unchanged.
// ---------------------------------------------------------------------------

/**
 * `users.email` has no UNIQUE constraint (spec/schema.sql) and spec/contract.md
 * requires none, so no uniqueness rule is imposed — two members may legitimately
 * share an address. The address is still shape-checked because the form declares
 * `type="email"` and the server should agree.
 */
const UserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "User name is required.")
    .max(200, "User name must be 200 characters or fewer."),
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Enter a valid email address."),
});

export async function createUser(input: {
  name: string;
  email: string;
}): Promise<ActionResult> {
  const parsed = UserSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      errors: fieldErrors(parsed.error),
      message: "Missing fields. Failed to create user.",
    };
  }

  const { name, email } = parsed.data;

  try {
    // RETURNING id so the client can navigate to the row it just created and so a
    // persisted id is provably allocated (spec/contract.md).
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO users (display_name, email)
      VALUES (${name}, ${email})
      RETURNING id::int AS id
    `;

    return { ok: true, id: row.id };
  } catch (error) {
    console.error("Database Error:", error);
    return { ok: false, message: "Database Error: Failed to create user." };
  }
}

export async function updateUser(input: {
  id: number;
  name: string;
  email: string;
}): Promise<ActionResult> {
  const { id } = input;
  const parsed = UserSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      errors: fieldErrors(parsed.error),
      message: "Missing fields. Failed to update user.",
    };
  }

  const { name, email } = parsed.data;

  try {
    // RETURNING distinguishes "no such row" from "row updated", so a stale form
    // cannot report success for a member who is already gone.
    const updated = await sql<{ id: number }[]>`
      UPDATE users
      SET display_name = ${name}, email = ${email}
      WHERE id = ${id}
      RETURNING id
    `;

    if (updated.length === 0) {
      return { ok: false, message: "That user no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { ok: false, message: "Database Error: Failed to update user." };
  }

  return { ok: true, id };
}

export async function deleteUser(id: number): Promise<ActionResult> {
  try {
    const deleted = await sql<{ id: number }[]>`
      DELETE FROM users WHERE id = ${id} RETURNING id
    `;

    if (deleted.length === 0) {
      return { ok: false, message: "That user no longer exists." };
    }
  } catch (error) {
    // Two different FKs behave differently here, and the difference is the whole
    // point of the message:
    //
    //   comments.author_id  ON DELETE RESTRICT — the delete is refused and
    //                                          nothing changes.
    //   tasks.assignee_id   ON DELETE SET NULL — the delete succeeds and the
    //                                          tasks become unassigned.
    //
    // So a failure here is always the comments restriction: 23001 is
    // restrict_violation and 23503 is what NO ACTION raises. This is a rule the
    // user can act on, so it is reported rather than thrown.
    const code = (error as { code?: string }).code;

    if (code === "23001" || code === "23503") {
      const [commentRows, taskRows] = await Promise.all([
        sql<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM comments WHERE author_id = ${id}
        `,
        sql<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM tasks WHERE assignee_id = ${id}
        `,
      ]);

      const commentCount = commentRows[0]?.count ?? 0;
      const taskCount = taskRows[0]?.count ?? 0;

      return {
        ok: false,
        message:
          `This person still has ${commentCount} ` +
          `${commentCount === 1 ? "comment" : "comments"} and ${taskCount} ` +
          `${taskCount === 1 ? "task" : "tasks"}. Remove ` +
          `${commentCount === 1 ? "the comment" : "the comments"} before deleting.`,
      };
    }

    console.error("Database Error:", error);
    return { ok: false, message: "Database Error: Failed to delete user." };
  }

  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Projects writes
// ---------------------------------------------------------------------------

const ProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required.")
    // The schema puts no limit on projects.name, but tasks.title caps at 200.
    .max(200, "Project name must be 200 characters or fewer."),
  description: z.string().trim(),
});

export async function createProject(input: {
  name: string;
  /** Optional: the column defaults to '' and an absent description is legal. */
  description?: string;
}): Promise<ActionResult> {
  const parsed = ProjectSchema.safeParse({
    name: input.name,
    description: input.description ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      errors: fieldErrors(parsed.error),
      message: "Missing fields. Failed to create project.",
    };
  }

  const { name, description } = parsed.data;

  try {
    // created_at is NOT NULL with no default, so the server sets it. RETURNING id
    // so the client has the row it just created.
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO projects (name, description, created_at)
      VALUES (${name}, ${description}, now())
      RETURNING id::int AS id
    `;

    return { ok: true, id: row.id };
  } catch (error) {
    console.error("Database Error:", error);
    return {
      ok: false,
      message: "Database Error: Failed to create project.",
    };
  }
}

export async function updateProject(input: {
  id: number;
  name: string;
  description?: string;
}): Promise<ActionResult> {
  const { id } = input;
  const parsed = ProjectSchema.safeParse({
    name: input.name,
    description: input.description ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      errors: fieldErrors(parsed.error),
      message: "Missing fields. Failed to update project.",
    };
  }

  const { name, description } = parsed.data;

  try {
    // RETURNING distinguishes "no such row" from "row updated", so a stale form
    // cannot report success for a project that is already gone.
    const updated = await sql<{ id: number }[]>`
      UPDATE projects
      SET name = ${name}, description = ${description}
      WHERE id = ${id}
      RETURNING id
    `;

    if (updated.length === 0) {
      return { ok: false, message: "That project no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return {
      ok: false,
      message: "Database Error: Failed to update project.",
    };
  }

  return { ok: true, id };
}

export async function deleteProject(id: number): Promise<ActionResult> {
  try {
    const deleted = await sql<{ id: number }[]>`
      DELETE FROM projects WHERE id = ${id} RETURNING id
    `;

    if (deleted.length === 0) {
      return { ok: false, message: "That project no longer exists." };
    }
  } catch (error) {
    // tasks.project_id is ON DELETE RESTRICT, so a project that still has tasks
    // cannot be removed. 23001 is restrict_violation; 23503 is what NO ACTION
    // raises, and both mean the same thing here. This is a rule the user can act
    // on, so it is reported rather than thrown.
    const code = (error as { code?: string }).code;

    if (code === "23001" || code === "23503") {
      const [row] = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM tasks WHERE project_id = ${id}
      `;

      const count = row?.count ?? 0;

      return {
        ok: false,
        message:
          count === 1
            ? "This project still has 1 task. Delete it before deleting the project."
            : `This project still has ${count} tasks. Delete them before deleting the project.`,
      };
    }

    console.error("Database Error:", error);
    return {
      ok: false,
      message: "Database Error: Failed to delete project.",
    };
  }

  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Tasks writes
// ---------------------------------------------------------------------------

/**
 * The task fields a create or update submits.
 *
 * The title bound matches the CHECK (char_length BETWEEN 1 AND 200) in
 * spec/schema.sql, so the same limit is enforced in the form and the database.
 */
const TaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .max(200, "Title must be 200 characters or fewer."),
  // An omitted description is legal (the column defaults to ''), so it is
  // normalised to "" rather than reported as a validation failure.
  description: z.preprocess(
    (value) => (value === null || value === undefined ? "" : value),
    z.string().trim(),
  ),
  status: z.enum(["todo", "in progress", "done"], {
    message: "Choose a valid status.",
  }),
});

/**
 * A comment submitted on its own, or as the first comment of a new task.
 *
 * The 1000-character bound matches the CHECK on `comments.body` in
 * spec/schema.sql, so the form and the database enforce the same limit.
 */
const CommentSchema = z.object({
  commentBody: z
    .string()
    .trim()
    .min(1, "Comment is required.")
    .max(1000, "Comment must be 1000 characters or fewer."),
  commentAuthorId: z.number().int().positive(),
});

/**
 * Checks the project and assignee a task references, before any insert.
 *
 * Both are foreign keys, so an id that matches no row would otherwise fail the
 * statement with a Postgres error the user cannot act on. Checking first turns it
 * into a field error against the select they filled in.
 *
 * Only worth doing once the field shapes are known to be good — a malformed
 * status should not send us to the database for a second opinion.
 */
async function checkTaskRefs({
  projectId,
  assigneeId,
}: {
  projectId: number;
  assigneeId: number | null;
}): Promise<Record<string, string[]>> {
  const errors: Record<string, string[]> = {};

  const [project] = await sql<{ id: number }[]>`
    SELECT id::int FROM projects WHERE id = ${projectId}
  `;

  if (!project) {
    errors.projectId = ["That project no longer exists."];
  }

  // An absent assignee is always fine: unassigned is a legal state.
  if (assigneeId !== null) {
    const [assignee] = await sql<{ id: number }[]>`
      SELECT id::int FROM users WHERE id = ${assigneeId}
    `;

    if (!assignee) {
      errors.assigneeId = ["That assignee no longer exists."];
    }
  }

  return errors;
}

/**
 * Checks only the assignee, for the update path.
 *
 * An update cannot move a task between projects — `projectId` is not accepted at
 * all — so the project's existence is not in question. Only the assignee can
 * change, and only it can be dangling.
 */
async function checkAssigneeRef(
  assigneeId: number | null,
): Promise<Record<string, string[]>> {
  if (assigneeId === null) return {};

  const [assignee] = await sql<{ id: number }[]>`
    SELECT id::int FROM users WHERE id = ${assigneeId}
  `;

  return assignee ? {} : { assigneeId: ["That assignee no longer exists."] };
}

/** The stored `project_id` of a task, or `null` when no row matches. */
async function projectOfTask(taskId: number) {
  const [row] = await sql<{ project_id: number }[]>`
    SELECT project_id::int FROM tasks WHERE id = ${taskId}
  `;

  return row ?? null;
}

export async function createTask(input: {
  title: string;
  description?: string;
  status: string;
  projectId: number;
  /** `null` means unassigned — spec/contract.md gives no other way to say it. */
  assigneeId?: number | null;
}): Promise<ActionResult> {
  const parsed = TaskSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      errors: fieldErrors(parsed.error),
      message: "Missing fields. Failed to create task.",
    };
  }

  const { title, description, status } = parsed.data;
  const assigneeId = input.assigneeId ?? null;

  const errors = await checkTaskRefs({
    projectId: input.projectId,
    assigneeId,
  });

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      errors,
      message: "Missing fields. Failed to create task.",
    };
  }

  try {
    // created_at and updated_at are NOT NULL with no default, so the server sets
    // both explicitly and to the same instant.
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO tasks (
        project_id, assignee_id, title, description, status, created_at, updated_at
      )
      VALUES (
        ${input.projectId}, ${assigneeId}, ${title}, ${description}, ${status}, now(), now()
      )
      RETURNING id::int AS id
    `;

    return { ok: true, id: row.id };
  } catch (error) {
    console.error("Database Error:", error);
    return { ok: false, message: "Database Error: Failed to create task." };
  }
}

/**
 * spec/queries.md — "Update task" by primary key, with `updated_at` set in the
 * statement rather than by a DB default or an ORM side effect. An update counts as
 * successful only if the intended row now holds the intended value, which
 * RETURNING confirms.
 *
 * `projectId` is deliberately not accepted. spec/contract.md lists the update
 * form's fields as title, status, assignee and description only — a task belongs
 * to its project for its lifetime, so accepting one would allow moving a task
 * behind a form that never offers the choice.
 */
export async function updateTask(input: {
  id: number;
  title: string;
  description?: string;
  status: string;
  assigneeId?: number | null;
}): Promise<ActionResult> {
  const { id } = input;
  const parsed = TaskSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      errors: fieldErrors(parsed.error),
      message: "Missing fields. Failed to update task.",
    };
  }

  const { title, description, status } = parsed.data;
  const assigneeId = input.assigneeId ?? null;

  const errors = await checkAssigneeRef(assigneeId);

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      errors,
      message: "Missing fields. Failed to update task.",
    };
  }

  // Read the project so the client knows which board to revalidate — the task is
  // leaving it or joining it. Also the only way to tell "no such task" apart from
  // "task updated", before the UPDATE has run.
  const existing = await projectOfTask(id);

  if (!existing) {
    return { ok: false, message: "That task no longer exists." };
  }

  try {
    // RETURNING distinguishes "no such row" from "row updated", so a stale form
    // cannot report success for a task that is already gone.
    const updated = await sql<{ id: number }[]>`
      UPDATE tasks
      SET
        title = ${title},
        description = ${description},
        status = ${status},
        assignee_id = ${assigneeId},
        updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `;

    if (updated.length === 0) {
      return { ok: false, message: "That task no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { ok: false, message: "Database Error: Failed to update task." };
  }

  return { ok: true, id };
}

/**
 * spec/queries.md — "Delete task" under the documented cascade: the task's comments
 * go with it via `comments.task_id` ON DELETE CASCADE.
 */
export async function deleteTask(id: number): Promise<ActionResult> {
  // Read the project first: the client redirects to that board afterwards, and the
  // task's detail page is not-found once the row is gone.
  const existing = await projectOfTask(id);

  if (!existing) {
    return { ok: false, message: "That task no longer exists." };
  }

  try {
    const deleted = await sql<{ id: number }[]>`
      DELETE FROM tasks WHERE id = ${id} RETURNING id
    `;

    if (deleted.length === 0) {
      return { ok: false, message: "That task no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { ok: false, message: "Database Error: Failed to delete task." };
  }

  return { ok: true, id };
}

/**
 * spec/queries.md — "Create with initial comment": one transaction inserting the
 * task then its comment, with any failure rolling back both.
 *
 * The transaction matters because the task insert alone would otherwise succeed
 * and leave a task whose first comment was never written — a partial state the
 * contract says must never be observable.
 */
export async function createTaskWithComment(input: {
  title: string;
  description?: string;
  status: string;
  projectId: number;
  assigneeId?: number | null;
  commentBody: string;
  commentAuthorId: number;
}): Promise<ActionResult> {
  const parsed = TaskSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      errors: fieldErrors(parsed.error),
      message: "Missing fields. Failed to create the task.",
    };
  }

  // The comment has its own bound (char_length BETWEEN 1 AND 1000), enforced by
  // its own schema so the message lands on the comment field.
  const comment = CommentSchema.safeParse({
    commentBody: input.commentBody,
    commentAuthorId: input.commentAuthorId,
  });

  if (!comment.success) {
    return {
      ok: false,
      errors: fieldErrors(comment.error),
      message: "Missing fields. Failed to create the task.",
    };
  }

  const { title, description, status } = parsed.data;
  const assigneeId = input.assigneeId ?? null;

  const errors = await checkTaskRefs({
    projectId: input.projectId,
    assigneeId,
  });

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      errors,
      message: "Missing fields. Failed to create the task.",
    };
  }

  // The author is a FK like the assignee, so an id that matches no row fails the
  // insert. Checking first turns that into a field error the user can act on.
  const [author] = await sql<{ id: number }[]>`
    SELECT id::int FROM users WHERE id = ${input.commentAuthorId}
  `;

  if (!author) {
    return {
      ok: false,
      errors: { commentAuthorId: ["That comment author no longer exists."] },
      message: "Missing fields. Failed to create the task.",
    };
  }

  try {
    const [row] = await sql.begin(async (tx) => {
      const [task] = await tx<{ id: number }[]>`
        INSERT INTO tasks (
          project_id, assignee_id, title, description, status, created_at, updated_at
        )
        VALUES (
          ${input.projectId}, ${assigneeId}, ${title}, ${description}, ${status}, now(), now()
        )
        RETURNING id::int AS id
      `;

      // Inside the same transaction, so a failure here throws and the task insert
      // above is rolled back with it.
      await tx`
        INSERT INTO comments (task_id, author_id, body, created_at)
        VALUES (${task.id}, ${input.commentAuthorId}, ${comment.data.commentBody}, now())
      `;

      return [task];
    });

    return { ok: true, id: row.id };
  } catch (error) {
    console.error("Database Error:", error);
    return {
      ok: false,
      message: "Database Error: Failed to create the task.",
    };
  }
}

// ---------------------------------------------------------------------------
// Comments writes
// ---------------------------------------------------------------------------

/**
 * Adds a comment to an existing task.
 *
 * Separate from `createTaskWithComment` because a comment on an existing task is a
 * single insert — the atomicity that form needs comes from being one transaction
 * with the task insert, which this path has no part in.
 */
export async function createComment(input: {
  taskId: number;
  commentBody: string;
  commentAuthorId: number;
}): Promise<ActionResult> {
  const { taskId } = input;
  const parsed = CommentSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      errors: fieldErrors(parsed.error),
      message: "Missing fields. Failed to add the comment.",
    };
  }

  const { commentBody, commentAuthorId } = parsed.data;

  // The task and the author are both foreign keys. Checking first turns an unknown
  // id into a field error the user can act on, rather than a thrown Postgres error.
  const [[task], [author]] = await Promise.all([
    sql<{ id: number }[]>`SELECT id::int FROM tasks WHERE id = ${taskId}`,
    sql<
      { id: number }[]
    >`SELECT id::int FROM users WHERE id = ${commentAuthorId}`,
  ]);

  if (!task) {
    return { ok: false, message: "That task no longer exists." };
  }

  if (!author) {
    return {
      ok: false,
      errors: { commentAuthorId: ["That comment author no longer exists."] },
      message: "Missing fields. Failed to add the comment.",
    };
  }

  try {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO comments (task_id, author_id, body, created_at)
      VALUES (${taskId}, ${commentAuthorId}, ${commentBody}, now())
      RETURNING id::int AS id
    `;

    return { ok: true, id: row.id };
  } catch (error) {
    console.error("Database Error:", error);
    return {
      ok: false,
      message: "Database Error: Failed to add the comment.",
    };
  }
}
