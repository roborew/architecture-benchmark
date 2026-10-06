import type {
  Comment,
  DashboardTask,
  Project,
  ProjectTaskRow,
  Task,
  TaskWithProject,
  User,
} from "@/lib/types";

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 9001,
    name: "Fixture project",
    description: "A project used only by unit tests.",
    taskCount: 2,
    openTaskCount: 1,
    peopleCount: 1,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 9101,
    projectId: 9001,
    title: "Fixture task",
    description: "A description used only by unit tests.",
    status: "todo",
    assigneeName: "Fixture Person",
    commentCount: 0,
    updatedAt: "Fixture day",
    ...overrides,
  };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 9501,
    taskId: 9101,
    authorName: "Fixture Commenter",
    body: "A comment used only by unit tests.",
    createdAt: "Fixture moment",
    ...overrides,
  };
}

export function makeTaskWithProject(
  overrides: Partial<TaskWithProject> = {},
): TaskWithProject {
  return { ...makeTask(), projectName: "Fixture project", ...overrides };
}

export function makeProjectTaskRow(
  overrides: Partial<ProjectTaskRow> = {},
): ProjectTaskRow {
  const row = {
    ...makeTaskWithProject(),
    createdAtRaw: "2026-01-01T00:00:00.000000Z",
    ...overrides,
  };

  return {
    ...row,
    cursorFor: overrides.cursorFor ?? `cursor-${row.id}`,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 9201,
    name: "Fixture Person",
    email: "fixture@example.test",
    assignedTaskCount: 1,
    openTaskCount: 1,
    commentCount: 0,
    ...overrides,
  };
}

export function makeRecentTask(
  overrides: Partial<DashboardTask> = {},
): DashboardTask {
  return {
    id: 9301,
    title: "Fixture recent task",
    projectName: "Fixture project",
    status: "todo",
    assigneeName: "Fixture Person",
    updatedAt: "Fixture day",
    ...overrides,
  };
}

export const fixtureProjects: Project[] = [
  makeProject({
    id: 9001,
    name: "Alpha project",
    taskCount: 2,
    openTaskCount: 1,
  }),
  makeProject({
    id: 9002,
    name: "Beta project",
    taskCount: 4,
    openTaskCount: 3,
  }),
];

export const fixtureTasks: Task[] = [
  makeTask({
    id: 9101,
    title: "Alpha task",
    status: "in progress",
    commentCount: 2,
  }),
  makeTask({ id: 9102, title: "Beta task", status: "todo", commentCount: 0 }),
];

export const fixtureTasksWithProject: TaskWithProject[] = [
  { ...fixtureTasks[0], projectName: "Alpha project" },
  { ...fixtureTasks[1], projectName: "Beta project" },
];

export const fixturePeople: User[] = [
  makeUser({
    id: 9201,
    name: "Person Alpha",
    assignedTaskCount: 7,
    openTaskCount: 3,
    commentCount: 1,
  }),
  makeUser({
    id: 9202,
    name: "Person Beta",
    assignedTaskCount: 2,
    openTaskCount: 1,
    commentCount: 0,
  }),
];
