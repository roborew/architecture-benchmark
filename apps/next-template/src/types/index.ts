export type Project = {
  id: number;
  name: string;
  description: string;
  taskCount: number;
  openTaskCount: number;
  peopleCount: number;
  createdAt: string;
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

export type DashboardProject = {
  id: number;
  name: string;
  description: string;
  taskCount: number;
  openTaskCount: number;
  peopleCount: number;
};

export type DashboardTask = {
  id: number;
  title: string;
  projectName: string;
  status: TaskStatus;
  assigneeName: string;
  updatedAt: string;
};

export type User = {
  id: number;
  name: string;
  email: string;
  assignedTaskCount: number;
  openTaskCount: number;
  commentCount: number;
};

// A task joined with its project name, for the workspace-wide list.
export type TaskWithProject = Task & { projectName: string };
