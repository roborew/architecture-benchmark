import type {
  DashboardTask,
  Project,
  Task,
  TaskWithProject,
  User,
} from "@/types";

// Deterministic fixtures for unit tests.
//
// The sentinel ids and names are deliberately unlike the app seed data.
// A test that accidentally depends on real seed values should fail
// loudly rather than quietly pass, which is what happens if these
// mirror the seed rows.
//
// Unit tests assert against the values they pass in, never against
// literals. When the data layer moves behind a database, these
// builders keep working unchanged: only the values change, not the
// component contract.

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 9001,
    name: "Fixture project",
    description: "A project used only by unit tests.",
    taskCount: 2,
    openTaskCount: 1,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 9101,
    projectId: 9001,
    title: "Fixture task",
    status: "todo",
    assigneeName: "Fixture Person",
    commentCount: 0,
    updatedAt: "Fixture day",
    ...overrides,
  };
}

export function makeTaskWithProject(
  overrides: Partial<TaskWithProject> = {},
): TaskWithProject {
  return { ...makeTask(), projectName: "Fixture project", ...overrides };
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

// A few distinct defaults so column assertions are unambiguous: two
// tasks in one project, and one person with three different counts.
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
