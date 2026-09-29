export type Project = {
  id: number;
  name: string;
  description: string;
  taskCount: number;
  openTaskCount: number;
  createdAt: string;
};

export type TaskStatus = "todo" | "in progress" | "done";

export type Task = {
  id: number;
  projectId: number;
  title: string;
  status: TaskStatus;
  assigneeName: string;
  commentCount: number;
  updatedAt: string;
};
