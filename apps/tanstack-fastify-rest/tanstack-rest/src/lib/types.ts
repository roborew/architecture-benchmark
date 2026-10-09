// src/lib/types.ts
//
// The row shapes the Fastify API returns. They mirror the reference variant's
// types (apps/tanstack-start-react/src/lib/types.ts) one for one, because both
// apps read the same database through the same projections — a row that
// differed in shape between the two would make one of them wrong about the
// data.

export type User = {
  id: number;
  name: string;
  email: string;
  assignedTaskCount: number;
  openTaskCount: number;
  commentCount: number;
};

export type TaskStatus = "todo" | "in progress" | "done";

export type Task = {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeName: string;
  commentCount: number;
  updatedAt: string;
};

// A task joined with its project name, for the workspace-wide listing: the
// tasks model projects `projectName` from the projects join.
export type TaskWithProject = Task & { projectName: string };

/**
 * A row from the workspace-wide task list.
 *
 * Carries `cursorFor` — the opaque `(updated_at, id)` tuple the next page
 * starts after — so the page can build the "older" link without re-querying
 * or guessing the sort order. `updatedAtRaw` is the same instant at
 * microsecond precision; it travels with the cursor and is not display state.
 */
export type TaskRow = TaskWithProject & {
  updatedAtRaw: string;
  cursorFor: string;
};

/**
 * A row from a project's task board.
 *
 * The same projection as `TaskRow`, but the board orders by `created_at`, so
 * the cursor components come from that column instead.
 */
export type ProjectTaskRow = TaskWithProject & {
  createdAtRaw: string;
  cursorFor: string;
};

// The recent-tasks table lists a task without its project id, description or
// comment count, but with its project name.
export type DashboardTask = Omit<
  TaskWithProject,
  "projectId" | "description" | "commentCount"
>;

export type Comment = {
  id: number;
  taskId: number;
  authorName: string;
  body: string;
  createdAt: string;
};

export type Project = {
  id: number;
  name: string;
  description: string;
  taskCount: number;
  openTaskCount: number;
  peopleCount: number;
  createdAt: string;
};

// The dashboard card shows the same project without the creation date.
export type DashboardProject = Omit<Project, "createdAt">;

export type DashboardStats = {
  projectCount: number;
  totalTasks: number;
  openTasks: number;
  peopleCount: number;
  todoTasks: number;
  inProgressTasks: number;
  doneTasks: number;
};

// The dashboard aggregate: one fetch for the three sections the home page
// renders, mirroring the reference variant's `fetchDashboard` payload.
export type DashboardData = {
  stats: DashboardStats;
  recentTasks: DashboardTask[];
  projects: DashboardProject[];
};
