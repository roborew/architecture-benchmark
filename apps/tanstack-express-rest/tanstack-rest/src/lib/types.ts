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
