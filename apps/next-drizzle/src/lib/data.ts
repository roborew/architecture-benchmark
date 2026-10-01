// src/lib/data.ts
//
// The query layer. Every read the app performs goes through Drizzle — the
// typed schema in `drizzle/schema.ts` is the single description of the tables,
// and `db` is the only connection the app makes.
//
// A few projections still reach for `sql` fragments, and deliberately so. The
// aggregates the dashboard cards render (`COUNT … FILTER`, `COUNT(DISTINCT …)`)
// have no helper in drizzle-orm 1.0.0-rc.4, and every timestamp is rendered to a
// pinned UTC string in SQL for the reason set out in `utcSecond` below. Those
// are expressions *within* a Drizzle query, not a fallback to raw SQL.

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
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  ilike,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { comments, projects, tasks, users } from "../../drizzle/schema";
import { decodeCursor, encodeCursor } from "./cursor";
import { db } from "./drizzle";

/**
 * Escapes the LIKE metacharacters so a search box treats them as literals.
 *
 * `ilike` compiles to a LIKE, and it escapes the *parameter* but not the
 * wildcards inside it. Without this, a single `%` matches every row and hides a
 * real filtering bug.
 */
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
 * Left to itself, node-postgres renders a `timestamptz` in the *server's* zone,
 * so one row reads `2026-09-29 09:00:00+01` on a machine west of UTC. Every
 * timestamp in the schema is UTC (spec/schema.sql) and the fixtures store the
 * ISO-Z form, so a screen rendering a local-time string would show a different
 * instant than the database holds — and a different one per machine. Each
 * projection therefore pins the zone in SQL rather than relying on the driver.
 *
 * Timestamps are rendered to whole seconds because that is the fixture
 * precision; a sub-second component would make an integration assertion fail on
 * a value the fixture never claimed to carry.
 */

/** A `timestamptz` as the ISO-Z instant the fixtures store: whole seconds, UTC. */
const utcSecond = (column: SQL | unknown) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/**
 * The same instant at microsecond precision, for building a keyset cursor.
 *
 * The display stamps above are truncated to whole seconds; a cursor cannot be,
 * because two rows sharing a second must still produce different cursors.
 */
const utcMicrosecond = (column: SQL | unknown) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z'`;

/** A `timestamptz` as the bare UTC calendar date the projects list shows. */
const utcDate = (column: SQL | unknown) =>
  sql<string>`(${column} at time zone 'UTC')::date::text`;

/**
 * The open-task count shared by every rollup that reports one.
 *
 * `COUNT(tasks.id) FILTER (WHERE status <> 'done')` is the one aggregate Drizzle
 * has no helper for — `countDistinct` cannot express a FILTER in 1.0.0-rc.4 —
 * so it is hand-written and `.mapWith(Number)`d to match the helpers' decoding,
 * which returns a bigint as a string otherwise.
 */
const openTaskCount = () =>
  sql<number>`count(${tasks.id}) filter (where ${ne(tasks.status, "done")})`.mapWith(
    Number,
  );

/**
 * The aggregate projection shared by `getUsers` and `getUser`.
 *
 * Every count is DISTINCT on its own side's key because the two LEFT JOINs
 * multiply: a member with 2 tasks and 2 comments produces 4 rows, and a plain
 * COUNT over that join would report 4 tasks.
 */
const USER_AGGREGATE_COLUMNS = {
  id: users.id,
  name: users.displayName,
  email: users.email,
  assignedTaskCount: countDistinct(tasks.id),
  openTaskCount:
    sql<number>`count(distinct ${tasks.id}) filter (where ${ne(tasks.status, "done")})`.mapWith(
      Number,
    ),
  commentCount: countDistinct(comments.id),
};

export async function getProjects(value = ""): Promise<Project[]> {
  const term = value.trim();
  const pattern = `%${escapeLike(term)}%`;

  try {
    return await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        taskCount: count(tasks.id),
        openTaskCount: openTaskCount(),
        peopleCount: countDistinct(tasks.assigneeId),
        createdAt: utcDate(projects.createdAt),
      })
      .from(projects)
      .leftJoin(tasks, eq(tasks.projectId, projects.id))
      .where(
        term
          ? or(
              ilike(projects.name, pattern),
              ilike(projects.description, pattern),
            )
          : undefined,
      )
      // Grouping by the primary key is enough for Postgres to accept the other
      // `projects` columns, since they are functionally dependent on it.
      .groupBy(projects.id)
      .orderBy(desc(projects.createdAt), desc(projects.id));
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
    const [project] = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        taskCount: count(tasks.id),
        openTaskCount: openTaskCount(),
        peopleCount: countDistinct(tasks.assigneeId),
        createdAt: utcDate(projects.createdAt),
      })
      .from(projects)
      .leftJoin(tasks, eq(tasks.projectId, projects.id))
      .where(eq(projects.id, id))
      .groupBy(projects.id);

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
    ? sql`(${tasks.createdAt}, ${tasks.id}) < (${decoded.createdAt}::text::timestamptz, ${decoded.id})`
    : undefined;

  // Clamped so a caller cannot ask for an unbounded page. One row above the page
  // size is allowed deliberately: fetching PAGE + 1 and dropping the last is
  // how the caller learns whether an older page exists without a COUNT.
  const bound = Math.max(1, Math.min(limit, PAGE_SIZE + 1));

  try {
    const rows = await db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        projectName: projects.name,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        // COALESCE covers the nullable `assignee_id`, which the old SQL did the
        // same way.
        assigneeName: sql<string>`coalesce(${users.displayName}, 'Unassigned')`,
        commentCount: count(comments.id),
        updatedAt: utcSecond(tasks.updatedAt),
        // The cursor needs microsecond precision, and a Z suffix since the
        // value is already in UTC.
        createdAtRaw: utcMicrosecond(tasks.createdAt),
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(comments, eq(comments.taskId, tasks.id))
      .where(
        and(
          eq(tasks.projectId, projectId),
          term ? eq(tasks.status, term) : undefined,
          cursorFilter,
        ),
      )
      .groupBy(tasks.id, projects.name, users.displayName, tasks.createdAt)
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(bound);

    // Derived here rather than in SQL so cursor packing has one implementation,
    // shared with the decoder this query uses to read a page back.
    return rows.map((row) => ({
      ...row,
      // The column is plain text in the database; the union lives in
      // `types.ts`, and the CHECK constraint is what keeps a value outside it
      // from ever arriving here.
      status: row.status as TaskStatus,
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
  const pattern = `%${escapeLike(term)}%`;

  // LIKE wildcards in a search box are almost always a literal character the
  // user typed, not a pattern. Without escaping, a single `%` matches every
  // row and hides a real filtering bug.
  const searchFilter = term
    ? or(ilike(tasks.title, pattern), ilike(tasks.description, pattern))
    : undefined;

  const decoded = decodeCursor(cursor);

  // Keyset rather than OFFSET: OFFSET re-walks every skipped row, so page 50
  // costs 50x page 1. Bound as text and cast in SQL so an unusable cursor
  // matches nothing instead of failing in the driver.
  const cursorFilter = decoded
    ? sql`(${tasks.updatedAt}, ${tasks.id}) < (${decoded.createdAt}::text::timestamptz, ${decoded.id})`
    : undefined;

  try {
    const rows = await db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        projectName: projects.name,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        assigneeName: sql<string>`coalesce(${users.displayName}, 'Unassigned')`,
        commentCount: count(comments.id),
        updatedAt: utcSecond(tasks.updatedAt),
        updatedAtRaw: utcMicrosecond(tasks.updatedAt),
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(comments, eq(comments.taskId, tasks.id))
      .where(
        and(
          projectId === undefined ? undefined : eq(tasks.projectId, projectId),
          statusTerm ? eq(tasks.status, statusTerm) : undefined,
          assigneeId === undefined
            ? undefined
            : eq(tasks.assigneeId, assigneeId),
          searchFilter,
          cursorFilter,
        ),
      )
      .groupBy(tasks.id, projects.name, users.displayName, tasks.updatedAt)
      .orderBy(desc(tasks.updatedAt), desc(tasks.id))
      .limit(Math.max(1, Math.min(limit, PAGE_SIZE + 1)));

    return rows.map((row) => ({
      ...row,
      status: row.status as TaskStatus,
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
    const [task] = await db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        projectName: projects.name,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        assigneeName: sql<string>`coalesce(${users.displayName}, 'Unassigned')`,
        commentCount: count(comments.id),
        updatedAt: utcSecond(tasks.updatedAt),
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(comments, eq(comments.taskId, tasks.id))
      .where(eq(tasks.id, id))
      .groupBy(tasks.id, projects.name, users.displayName);

    return task ? { ...task, status: task.status as TaskStatus } : null;
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
    return await db
      .select({
        id: comments.id,
        taskId: comments.taskId,
        authorName: users.displayName,
        body: comments.body,
        createdAt: utcSecond(comments.createdAt),
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.taskId, taskId))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(Math.max(1, Math.min(limit, COMMENTS_PER_TASK)));
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
  const pattern = `%${escapeLike(term)}%`;

  const searchFilter = term
    ? or(ilike(tasks.title, pattern), ilike(tasks.description, pattern))
    : undefined;

  try {
    const [row] = await db
      .select({ count: count() })
      .from(tasks)
      .where(
        and(
          projectId === undefined ? undefined : eq(tasks.projectId, projectId),
          statusTerm ? eq(tasks.status, statusTerm) : undefined,
          assigneeId === undefined
            ? undefined
            : eq(tasks.assigneeId, assigneeId),
          searchFilter,
        ),
      );

    return row?.count ?? 0;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to count tasks.");
  }
}

/**
 * Workspace totals for the dashboard's stat cards.
 *
 * One statement rather than seven, because the cards are rendered together and
 * separate COUNT queries would each scan a different table for the same row.
 *
 * The `FROM (select 1)` is what makes an empty workspace work: the subqueries
 * are all aggregate scalars that would each return a row on their own, but
 * Drizzle needs *some* FROM to build the select from, and this one yields
 * exactly one row no matter how few projects exist.
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const [stats] = await db
      .select({
        projectCount: sql<number>`(select count(*)::int from ${projects})`,
        totalTasks: sql<number>`(select count(*)::int from ${tasks})`,
        openTasks: sql<number>`(select count(*)::int from ${tasks} where ${ne(tasks.status, "done")})`,
        peopleCount: sql<number>`(select count(*)::int from ${users})`,
        todoTasks: sql<number>`(select count(*)::int from ${tasks} where ${eq(tasks.status, "todo")})`,
        inProgressTasks: sql<number>`(select count(*)::int from ${tasks} where ${eq(tasks.status, "in progress")})`,
        doneTasks: sql<number>`(select count(*)::int from ${tasks} where ${eq(tasks.status, "done")})`,
      })
      .from(sql`(select 1) as one_row`);

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
    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        projectName: projects.name,
        status: tasks.status,
        assigneeName: sql<string>`coalesce(${users.displayName}, 'Unassigned')`,
        updatedAt: utcSecond(tasks.updatedAt),
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .orderBy(desc(tasks.updatedAt), desc(tasks.id))
      .limit(Math.max(1, Math.min(limit, DASHBOARD_RECENT_TASKS)));

    return rows.map((row) => ({ ...row, status: row.status as TaskStatus }));
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
    return await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        taskCount: count(tasks.id),
        openTaskCount: openTaskCount(),
        peopleCount: countDistinct(tasks.assigneeId),
      })
      .from(projects)
      .leftJoin(tasks, eq(tasks.projectId, projects.id))
      .groupBy(projects.id)
      .orderBy(desc(count(tasks.id)), projects.id)
      .limit(Math.max(1, Math.min(limit, DASHBOARD_PROJECTS)));
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch dashboard projects.");
  }
}

export async function getUsers(value = ""): Promise<User[]> {
  const term = value.trim();
  const pattern = `%${escapeLike(term)}%`;

  try {
    return await db
      .select(USER_AGGREGATE_COLUMNS)
      .from(users)
      .leftJoin(tasks, eq(users.id, tasks.assigneeId))
      .leftJoin(comments, eq(users.id, comments.authorId))
      .where(
        term
          ? or(ilike(users.displayName, pattern), ilike(users.email, pattern))
          : undefined,
      )
      .groupBy(users.id, users.displayName, users.email)
      .orderBy(desc(users.displayName), desc(users.id));
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
    const [user] = await db
      .select(USER_AGGREGATE_COLUMNS)
      .from(users)
      .leftJoin(tasks, eq(users.id, tasks.assigneeId))
      .leftJoin(comments, eq(users.id, comments.authorId))
      .where(eq(users.id, id))
      .groupBy(users.id, users.displayName, users.email);

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
    const rows = await db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        projectName: projects.name,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        assigneeName: sql<string>`coalesce(${users.displayName}, 'Unassigned')`,
        commentCount: count(comments.id),
        updatedAt: utcSecond(tasks.updatedAt),
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(comments, eq(comments.taskId, tasks.id))
      .where(eq(tasks.assigneeId, id))
      .groupBy(tasks.id, projects.name, users.displayName, tasks.updatedAt)
      .orderBy(desc(tasks.updatedAt), desc(tasks.id));

    return rows.map((row) => ({ ...row, status: row.status as TaskStatus }));
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch the user's tasks.");
  }
}
