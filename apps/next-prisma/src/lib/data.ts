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
  UserRow,
} from "@/lib/types";
import { decodeCursor, encodeCursor } from "./cursor";
import prisma from "./prisma";

/**
 * Escapes the LIKE metacharacters so a search box treats them as literals.
 *
 * Prisma's `contains` compiles to a LIKE, and it escapes the *parameter* but not
 * the wildcards inside it. Without this, a single `%` matches every row and hides
 * a real filtering bug.
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
 * Every timestamp in the schema is `timestamptz` and UTC (spec/schema.sql), and
 * the fixtures store the ISO-Z form, so a screen rendering a local-time string
 * would show a different instant than the database holds — and a different one
 * per machine. Prisma hands back a `Date` rather than a pre-rendered string, so
 * the zone and the precision are both re-applied here.
 *
 * Timestamps are rendered to whole seconds because that is the fixture
 * precision; a sub-second component would make an integration assertion fail on
 * a value the fixture never claimed to carry.
 */

/**
 * Renders a `timestamptz` the way the fixtures store it: whole seconds, UTC, an
 * ISO-Z string rather than a `Date`. This replaces the
 * `to_char(… AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` the old SQL
 * projections pinned — Prisma returns a `Date`, so both have to be re-applied.
 */
function toUtcSecond(value: Date): string {
  return value.toISOString().slice(0, 19) + "Z";
}

/**
 * Renders a `timestamptz` as the UTC calendar date the projects list shows.
 *
 * `toISOString` already converts to UTC before slicing, so this is the same
 * instant `AT TIME ZONE 'UTC'` produced, minus the time of day. `formatDate`
 * consumes it as a bare `YYYY-MM-DD`.
 */
function toUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The open-task count shared by `getUsers` and `getUser`.
 *
 * Prisma's `_count` counts each relation once, so the open count — the old
 * `COUNT(DISTINCT t.id) FILTER (WHERE t.status <> 'done')` — cannot be a second
 * entry in the same `select`. It comes from a separate query grouped by assignee
 * and merged by key, which is also why the DISTINCT is no longer needed: grouping
 * already collapses the join multiplication the SQL had to guard against.
 *
 * `scope` narrows the grouping to one member, so `getUser` does not aggregate
 * the whole task table to read a single row.
 */
async function openTaskCounts(
  scope: { assignee_id?: bigint } = {},
): Promise<Map<bigint, number>> {
  const grouped = await prisma.tasks.groupBy({
    by: ["assignee_id"],
    where: { status: { not: "done" }, ...scope },
    _count: { _all: true },
  });

  // `assignee_id` is nullable, so the key is `bigint | null` until filtered.
  return new Map(
    grouped
      .filter((g) => g.assignee_id !== null)
      .map((g) => [g.assignee_id as bigint, g._count._all]),
  );
}

function toUser(row: UserRow, openCounts: Map<bigint, number>): User {
  return {
    // Every pk is a BigInt in the schema, but the UI does arithmetic and
    // comparisons on `id`, so it crosses the boundary as a number.
    id: Number(row.id),
    name: row.display_name,
    email: row.email,
    assignedTaskCount: row._count.tasks,
    // Keyed by the raw BigInt — that is what the groupBy returned. Keying by
    // the mapped `id` would never match.
    openTaskCount: openCounts.get(row.id) ?? 0,
    commentCount: row._count.comments,
  };
}

type ProjectRollup = {
  taskCount: number;
  openTaskCount: number;
  peopleCount: number;
};

const NO_TASKS: ProjectRollup = {
  taskCount: 0,
  openTaskCount: 0,
  peopleCount: 0,
};

/**
 * The per-project task totals the project list and the dashboard cards render.
 *
 * The SQL did this as one `GROUP BY p.id` over a LEFT JOIN. Prisma has no
 * equivalent — `groupBy` counts a chosen relation but cannot count it
 * *conditionally*, and `peopleCount` is a `COUNT(DISTINCT assignee_id)` that no
 * count expression can express — so this groups by the three columns that fully
 * determine the answer and folds them in JS.
 *
 * Grouping on `(assignee_id, status)` is what collapses the join multiplication
 * the SQL guarded against with DISTINCT: each combination is already one row, so
 * summing its count cannot double-count a task. Grouping on `assignee_id` also
 * gives `peopleCount` as a set size, and it excludes NULL by construction — which
 * is what `COUNT(DISTINCT assignee_id)` did.
 *
 * A project with no tasks is absent from the map rather than present with
 * zeros; callers substitute `NO_TASKS`, matching the LEFT JOIN's row.
 */
async function projectRollups(): Promise<Map<bigint, ProjectRollup>> {
  const grouped = await prisma.tasks.groupBy({
    by: ["project_id", "assignee_id", "status"],
    _count: { _all: true },
  });

  const totals = new Map<bigint, ProjectRollup>();
  const assignees = new Map<bigint, Set<bigint>>();

  for (const row of grouped) {
    const { project_id: projectId, assignee_id: assigneeId, status } = row;
    const count = row._count._all;

    let entry = totals.get(projectId);

    if (!entry) {
      entry = { ...NO_TASKS };
      totals.set(projectId, entry);
      assignees.set(projectId, new Set());
    }

    entry.taskCount += count;

    if (status !== "done") {
      entry.openTaskCount += count;
    }

    // `COUNT(DISTINCT assignee_id)` ignores NULLs, so an unassigned task never
    // contributes a person.
    if (assigneeId !== null) {
      assignees.get(projectId)!.add(assigneeId);
    }
  }

  for (const [projectId, people] of assignees) {
    totals.get(projectId)!.peopleCount = people.size;
  }

  return totals;
}

/** The `(created_at, id)` and `(updated_at, id)` page windows. */
function taskRowSelect() {
  return {
    id: true,
    project_id: true,
    title: true,
    description: true,
    status: true,
    updated_at: true,
    created_at: true,
    projects: { select: { name: true } },
    users: { select: { display_name: true } },
    _count: { select: { comments: true } },
  } as const;
}

/**
 * Flattens a selected task row into the shape the three task pages share.
 *
 * Declared once because the same task is rendered by three pages; a projection
 * that drifted between them would show one task with two different statuses.
 */
function toTaskRow(row: {
  id: bigint;
  project_id: bigint;
  title: string;
  description: string;
  status: string;
  updated_at: Date;
  projects: { name: string };
  users: { display_name: string } | null;
  _count: { comments: number };
}): TaskWithProject {
  return {
    id: Number(row.id),
    projectId: Number(row.project_id),
    projectName: row.projects.name,
    title: row.title,
    description: row.description,
    // The column is plain text in the database; the union lives in
    // `types.ts`, and the CHECK constraint on the table is what keeps a value
    // outside it from ever arriving here.
    status: row.status as TaskStatus,
    // `assignee_id` is nullable, which the old SQL covered with a COALESCE.
    assigneeName: row.users?.display_name ?? "Unassigned",
    commentCount: row._count.comments,
    updatedAt: toUtcSecond(row.updated_at),
  };
}

/**
 * Renders a timestamp at microsecond precision for the keyset cursor.
 *
 * The display stamps above are truncated to whole seconds; a cursor cannot be,
 * because two rows sharing a second must still produce different cursors.
 */
function toUtcMicrosecond(value: Date): string {
  return `${value.toISOString().slice(0, 26)}Z`;
}

export async function getProjects(value = ""): Promise<Project[]> {
  const term = value.trim();
  const search = escapeLike(term);

  try {
    // Independent queries, so they run concurrently: the project rows and the
    // per-project totals never depend on each other.
    const [projects, rollups] = await Promise.all([
      prisma.projects.findMany({
        // `contains` compiles to an ILIKE, so the term has to be escaped or a
        // search for `%` would match every project.
        where: term
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
              ],
            }
          : undefined,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        select: { id: true, name: true, description: true, created_at: true },
      }),
      projectRollups(),
    ]);

    return projects.map((project) => {
      const rollup = rollups.get(project.id) ?? NO_TASKS;

      return {
        id: Number(project.id),
        name: project.name,
        description: project.description,
        taskCount: rollup.taskCount,
        openTaskCount: rollup.openTaskCount,
        peopleCount: rollup.peopleCount,
        createdAt: toUtcDate(project.created_at),
      };
    });
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
    const [project, rollups] = await Promise.all([
      prisma.projects.findFirst({
        where: { id },
        select: { id: true, name: true, description: true, created_at: true },
      }),
      projectRollups(),
    ]);

    if (!project) {
      return null;
    }

    const rollup = rollups.get(project.id) ?? NO_TASKS;

    return {
      id: Number(project.id),
      name: project.name,
      description: project.description,
      taskCount: rollup.taskCount,
      openTaskCount: rollup.openTaskCount,
      peopleCount: rollup.peopleCount,
      createdAt: toUtcDate(project.created_at),
    };
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
 * spec/queries.md fixes the shape: `tasks` driving, the assignee joined on the
 * nullable `assignee_id`, ordered `(created_at DESC, id DESC)` and `LIMIT`ed.
 * `id` is the tiebreaker because fixture timestamps are unique but a live insert
 * can share one, and an unstable order would make a keyset page skip or repeat
 * a row.
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

  // Clamped so a caller cannot ask for an unbounded page. One row above the page
  // size is allowed deliberately: fetching PAGE + 1 and dropping the last is
  // how the caller learns whether an older page exists without a COUNT.
  const bound = Math.max(1, Math.min(limit, PAGE_SIZE + 1));

  try {
    const rows = await prisma.tasks.findMany({
      where: {
        project_id: projectId,
        ...(term ? { status: term } : {}),
      },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      // Keyset rather than OFFSET: OFFSET re-walks every skipped row, so page 50
      // costs 50x page 1, and a row inserted mid-walk shifts the window.
      //
      // Prisma's cursor turns the unique `id` into the same row-tuple predicate
      // the SQL spelled out by hand — `(created_at, id) < (…)` — so
      // tasks_project_created_id_idx is still the access path. A cursor naming a
      // row that no longer exists simply matches nothing, rather than failing.
      ...(decoded ? { cursor: { id: BigInt(decoded.id) }, skip: 1 } : {}),
      take: bound,
      select: taskRowSelect(),
    });

    // Derived here rather than in the query so cursor packing has one
    // implementation, shared with the decoder this query uses to read a page back.
    return rows.map((row) => {
      const createdAtRaw = toUtcMicrosecond(row.created_at);

      return {
        ...toTaskRow(row),
        createdAtRaw,
        cursorFor: encodeCursor(createdAtRaw, Number(row.id)),
      };
    });
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
 * The `where` clause shared by `getTasks` and `countTasks`.
 *
 * Both the page and the "Showing 1-25 of N" line come from here, so a filter can
 * never narrow one and not the other — a mismatch would show "1-2 of 6" for a
 * two-row page.
 */
function taskWhere({
  projectId,
  status = "",
  assigneeId,
  search = "",
}: TaskFilters): Record<string, unknown> {
  const statusTerm = status.trim();

  if (statusTerm && !TASK_STATUSES.includes(statusTerm as TaskStatus)) {
    throw new Error(`Unknown task status: ${statusTerm}`);
  }

  const term = search.trim();
  const escaped = escapeLike(term);

  return {
    ...(projectId === undefined ? {} : { project_id: projectId }),
    ...(statusTerm ? { status: statusTerm } : {}),
    ...(assigneeId === undefined ? {} : { assignee_id: assigneeId }),
    ...(term
      ? {
          OR: [
            { title: { contains: escaped, mode: "insensitive" } },
            { description: { contains: escaped, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

/**
 * The workspace-wide task list, newest updated first.
 *
 * Shares its projection with `getProjectTasks` so a row cannot look different
 * depending on which page fetched it — the same task must render identically in
 * the project board, the workspace list and its detail page.
 */
export async function getTasks({
  limit = PAGE_SIZE,
  cursor = null,
  ...filters
}: TaskFilters = {}): Promise<TaskRow[]> {
  const where = taskWhere(filters);
  const decoded = decodeCursor(cursor);

  try {
    const rows = await prisma.tasks.findMany({
      where,
      orderBy: [{ updated_at: "desc" }, { id: "desc" }],
      // Keyset rather than OFFSET, for the reasons spelled out in
      // `getProjectTasks`. Prisma compiles the unique `id` cursor into
      // `(updated_at, id) < (…)` against tasks' indexes.
      ...(decoded ? { cursor: { id: BigInt(decoded.id) }, skip: 1 } : {}),
      take: Math.max(1, Math.min(limit, PAGE_SIZE + 1)),
      select: taskRowSelect(),
    });

    return rows.map((row) => {
      const updatedAtRaw = toUtcMicrosecond(row.updated_at);

      return {
        ...toTaskRow(row),
        updatedAtRaw,
        cursorFor: encodeCursor(updatedAtRaw, Number(row.id)),
      };
    });
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch tasks.");
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
export async function countTasks(filters: TaskFilters = {}): Promise<number> {
  try {
    return await prisma.tasks.count({ where: taskWhere(filters) });
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to count tasks.");
  }
}

/**
 * One task by id, with the project and assignee names the detail page renders,
 * or `null` when no row matches.
 *
 * Fetched by primary key, so it carries no cursor: there is no page to resume.
 */
export async function getTask(id: number): Promise<TaskWithProject | null> {
  try {
    const row = await prisma.tasks.findFirst({
      where: { id },
      select: taskRowSelect(),
    });

    return row ? toTaskRow(row) : null;
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
    const comments = await prisma.comments.findMany({
      where: { task_id: taskId },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(limit, COMMENTS_PER_TASK)),
      select: {
        id: true,
        task_id: true,
        body: true,
        created_at: true,
        users: { select: { display_name: true } },
      },
    });

    return comments.map((comment) => ({
      id: Number(comment.id),
      taskId: Number(comment.task_id),
      authorName: comment.users.display_name,
      body: comment.body,
      createdAt: toUtcSecond(comment.created_at),
    }));
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch the task comments.");
  }
}

/**
 * Workspace totals for the dashboard's stat cards.
 *
 * Issued as one batched transaction rather than seven separate awaits, because
 * the cards are rendered together and separate round trips would each re-check
 * the same rows at a different moment — a task created mid-render would show up
 * in `totalTasks` but not in `todoTasks`, and the cards would not add up.
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const [
      projectCount,
      totalTasks,
      openTasks,
      peopleCount,
      todoTasks,
      inProgressTasks,
      doneTasks,
    ] = await prisma.$transaction([
      prisma.projects.count(),
      prisma.tasks.count(),
      prisma.tasks.count({ where: { status: { not: "done" } } }),
      prisma.users.count(),
      prisma.tasks.count({ where: { status: "todo" } }),
      prisma.tasks.count({ where: { status: "in progress" } }),
      prisma.tasks.count({ where: { status: "done" } }),
    ]);

    return {
      projectCount,
      totalTasks,
      openTasks,
      peopleCount,
      todoTasks,
      inProgressTasks,
      doneTasks,
    };
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
    const tasks = await prisma.tasks.findMany({
      orderBy: [{ updated_at: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(limit, DASHBOARD_RECENT_TASKS)),
      select: {
        id: true,
        title: true,
        status: true,
        updated_at: true,
        projects: { select: { name: true } },
        users: { select: { display_name: true } },
      },
    });

    // Deliberately built field by field rather than spread from a wider row: the
    // recent-tasks table has no project column and no comment count, and a test
    // asserts those keys are absent.
    return tasks.map((task) => ({
      id: Number(task.id),
      title: task.title,
      projectName: task.projects.name,
      status: task.status as TaskStatus,
      assigneeName: task.users?.display_name ?? "Unassigned",
      updatedAt: toUtcSecond(task.updated_at),
    }));
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch recent tasks.");
  }
}

/**
 * The busiest projects, for the dashboard's project cards.
 *
 * Ordered by task count so the cards answer "where is the work?" rather than
 * repeating the newest-first ordering of every other list. The order is applied
 * in JS rather than in the query because Prisma cannot order by a computed
 * count; the totals themselves still come from a single grouped read.
 */
export async function getDashboardProjects(
  limit = DASHBOARD_PROJECTS,
): Promise<DashboardProject[]> {
  try {
    const [projects, rollups] = await Promise.all([
      prisma.projects.findMany({
        select: { id: true, name: true, description: true },
      }),
      projectRollups(),
    ]);

    return (
      projects
        .map((project) => {
          const rollup = rollups.get(project.id) ?? NO_TASKS;

          return {
            id: Number(project.id),
            name: project.name,
            description: project.description,
            taskCount: rollup.taskCount,
            openTaskCount: rollup.openTaskCount,
            peopleCount: rollup.peopleCount,
          };
        })
        // `id` is the tiebreaker so the order is stable: two projects with the same
        // task count must not swap places between renders.
        .sort((a, b) => b.taskCount - a.taskCount || a.id - b.id)
        .slice(0, Math.max(1, Math.min(limit, DASHBOARD_PROJECTS)))
    );
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch dashboard projects.");
  }
}

export async function getUsers(value = ""): Promise<User[]> {
  const term = value.trim();
  // `contains` compiles to a LIKE, so the term has to be escaped or a search for
  // `%` would match every member. Prisma does not escape it for us.
  const search = escapeLike(term);

  try {
    // Independent queries, so they run concurrently. The member rows and the
    // open-task groups never depend on each other.
    const [rows, openCounts] = await Promise.all([
      prisma.users.findMany({
        where: term
          ? {
              OR: [
                { display_name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : undefined,
        orderBy: [{ display_name: "desc" }, { id: "desc" }],
        select: {
          id: true,
          display_name: true,
          email: true,
          _count: { select: { tasks: true, comments: true } },
        },
      }),
      openTaskCounts(),
    ]);

    return rows.map((row) => toUser(row, openCounts));
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
    const [row] = await prisma.users.findMany({
      where: { id },
      select: {
        id: true,
        display_name: true,
        email: true,
        _count: { select: { tasks: true, comments: true } },
      },
    });

    if (!row) {
      return null;
    }

    // Scoped to this member rather than grouping the whole task table, and
    // sequential rather than concurrent: without a row there is nothing to
    // merge the count into, so the second query would be wasted.
    const openCounts = await openTaskCounts({ assignee_id: BigInt(id) });

    return toUser(row, openCounts);
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
    const tasks = await prisma.tasks.findMany({
      where: { assignee_id: id },
      // The id tie-break is not decoration: the integration test sorts its
      // expectation by `updatedAt` alone, so two tasks sharing an instant have
      // to come back in a stable order for that assertion to hold.
      orderBy: [{ updated_at: "desc" }, { id: "desc" }],
      select: taskRowSelect(),
    });

    return tasks.map((task) => toTaskRow(task));
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch the user's tasks.");
  }
}
