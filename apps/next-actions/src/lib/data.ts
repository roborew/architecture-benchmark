import type {
  Project,
  ProjectTaskRow,
  TaskStatus,
  TaskWithProject,
  User,
} from "@/lib/types";
import { decodeCursor, encodeCursor } from "./cursor";
import { sql } from "./db";

const escapeLike = (term: string) => term.replace(/[\\%_]/g, "\\$&");

/**
 * spec/queries.md — "List project tasks" returns up to 25 rows, newest first.
 * `PAGE_SIZE` is that bound; it is also the default `limit`, so a page cannot
 * silently grow past the contract.
 */
const PAGE_SIZE = 25;

const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in progress", "done"];

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
 * Every count is DISTINCT on its own side's key because the two LEFT JOINs
 * multiply: a member with 2 tasks and 2 comments produces 4 rows, and a plain
 * COUNT over that join would report 4 tasks.
 */
const USER_AGGREGATES = sql`
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
    COALESCE(u.display_name, 'Unassigned') AS "assigneeName",
    COUNT(c.id)::int AS "commentCount",
    to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
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

export type TaskFilters = {
  projectId?: number;
  status?: string;
  assigneeId?: number;
  search?: string;
  limit?: number;
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
}: TaskFilters = {}): Promise<TaskWithProject[]> {
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

  try {
    return await sql<TaskWithProject[]>`
      ${TASK_PROJECTION}
      WHERE 1 = 1
      ${projectId === undefined ? sql`` : sql`AND t.project_id = ${projectId}`}
      ${statusTerm ? sql`AND t.status = ${statusTerm}` : sql``}
      ${assigneeId === undefined ? sql`` : sql`AND t.assignee_id = ${assigneeId}`}
      ${searchFilter}
      GROUP BY t.id, p.name, u.display_name
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT ${Math.max(1, Math.min(limit, PAGE_SIZE))}
    `;
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
      GROUP BY u.id, u.display_name, u.email
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
      GROUP BY u.id, u.display_name, u.email
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
