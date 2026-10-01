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

// A task joined with its project name, for the workspace-wide list.
export type TaskWithProject = Task & { projectName: string };

/**
 * A row from the project task board.
 *
 * Carries `cursorFor` — the `(created_at, id)` tuple the next page starts after —
 * so the page can build the "older" link without re-querying or guessing the
 * sort order. `createdAtRaw` keeps full precision (microseconds) for exactly
 * that purpose; it is not display state, which is why the cursor is a separate
 * field rather than something the components render.
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

export type DashboardStats = {
  projectCount: number;
  totalTasks: number;
  openTasks: number;
  peopleCount: number;
  todoTasks: number;
  inProgressTasks: number;
  doneTasks: number;
};

export type User = {
  id: number;
  name: string;
  email: string;
  assignedTaskCount: number;
  openTaskCount: number;
  commentCount: number;
};
