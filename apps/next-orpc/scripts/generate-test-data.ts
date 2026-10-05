// scripts/generate-test-data.ts
//
// Regenerates `tests/fixtures/data.ts` from the shared fixture profile in
// `spec/snapshots/correctness/`.
//
// The spec CSVs are the source of truth — the same rows any app variant seeds
// from. Generating the unit fixtures from them is what stops the three test
// tiers drifting apart: the e2e suite seeds these exact rows into its database
// while unit tests render them in jsdom, so a value asserted in one is by
// construction the same value asserted in the others.
//
// Run with:  pnpm test:data
//
// Counts and derived lists are computed here rather than hand-written, so a
// fixture change cannot leave a stale `commentCount` or stat total behind.

import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  FIXTURE_PROFILE,
  loadComments,
  loadProjects,
  loadTasks,
  loadUsers,
} from "../tests/fixtures/load";

type Status = "todo" | "in progress" | "done";

const users = loadUsers();
const projects = loadProjects();
const tasks = loadTasks();
const comments = loadComments();

const userName = (id: number) =>
  users.find((u) => u.id === id)?.displayName ?? "";
const projectName = (id: number) =>
  projects.find((p) => p.id === id)?.name ?? "";

/** "YYYY-MM-DDTHH:MM:SSZ" -> the date portion the list views render. */
const day = (timestamp: string) => timestamp.slice(0, 10);

const commentCountFor = (taskId: number) =>
  comments.filter((c) => c.taskId === taskId).length;

const commentCountForAuthor = (authorId: number) =>
  comments.filter((c) => c.authorId === authorId).length;

const openTasks = tasks.filter((t) => t.status !== "done");

const assigneesFor = (projectId: number) =>
  new Set(
    tasks
      .filter((t) => t.projectId === projectId && t.assigneeId !== null)
      .map((t) => t.assigneeId),
  ).size;

const tasksForProject = (projectId: number) =>
  tasks
    .filter((t) => t.projectId === projectId)
    .map((t) => ({
      id: t.id,
      projectId: t.projectId,
      title: t.title,
      description: t.description,
      status: t.status as Status,
      assigneeId: t.assigneeId,
      assigneeName: userName(t.assigneeId as number),
      commentCount: commentCountFor(t.id),
      updatedAt: t.updatedAt,
    }));

const generated = `// GENERATED FILE — do not edit by hand.
//
// Regenerate with:  pnpm test:data
//
// Source of truth: spec/snapshots/${FIXTURE_PROFILE}/*.csv — the same rows the
// e2e suite seeds into its isolated database and the integration suite queries.
// Deriving this file from those CSVs is what keeps the unit, integration and e2e
// suites asserting identical rows; a hand-edited copy previously drifted from
// the seeded database and made the e2e suite fail for reasons that had nothing
// to do with the code under test.

import type {
  Comment,
  DashboardProject,
  DashboardStats,
  DashboardTask,
  Project,
  Task,
  TaskWithProject,
  User,
} from "@/lib/types";

export const projects: Project[] = ${JSON.stringify(
  projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    taskCount: tasks.filter((t) => t.projectId === p.id).length,
    openTaskCount: openTasks.filter((t) => t.projectId === p.id).length,
    peopleCount: assigneesFor(p.id),
    createdAt: day(p.createdAt),
  })),
  null,
  2,
)};

export const projectTasks: Record<number, Task[]> = ${JSON.stringify(
  Object.fromEntries(projects.map((p) => [p.id, tasksForProject(p.id)])),
  null,
  2,
)};

export const taskComments: Comment[] = ${JSON.stringify(
  comments.map((c) => ({
    id: c.id,
    taskId: c.taskId,
    authorName: userName(c.authorId),
    body: c.body,
    createdAt: c.createdAt,
  })),
  null,
  2,
)};

export const dashboardStats: DashboardStats = {
  projectCount: ${projects.length},
  totalTasks: ${tasks.length},
  openTasks: ${openTasks.length},
  peopleCount: ${users.length},
  todoTasks: ${tasks.filter((t) => t.status === "todo").length},
  inProgressTasks: ${tasks.filter((t) => t.status === "in progress").length},
  doneTasks: ${tasks.filter((t) => t.status === "done").length},
};

// Newest updated first, capped the way the dashboard shows them.
export const dashboardRecentTasks: DashboardTask[] = ${JSON.stringify(
  [...tasks]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3)
    .map((t) => ({
      id: t.id,
      title: t.title,
      projectName: projectName(t.projectId),
      status: t.status as Status,
      assigneeId: t.assigneeId,
      assigneeName: userName(t.assigneeId as number),
      updatedAt: t.updatedAt,
    })),
  null,
  2,
)};

// The busiest projects, matching the two cards the dashboard renders.
export const dashboardProjects: DashboardProject[] = ${JSON.stringify(
  [...projects]
    .sort(
      (a, b) =>
        tasks.filter((t) => t.projectId === b.id).length -
        tasks.filter((t) => t.projectId === a.id).length,
    )
    .slice(0, 2)
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      taskCount: tasks.filter((t) => t.projectId === p.id).length,
      openTaskCount: openTasks.filter((t) => t.projectId === p.id).length,
      peopleCount: assigneesFor(p.id),
    })),
  null,
  2,
)};

export const people: User[] = ${JSON.stringify(
  users.map((u) => ({
    id: u.id,
    name: u.displayName,
    email: u.email,
    assignedTaskCount: tasks.filter((t) => t.assigneeId === u.id).length,
    openTaskCount: openTasks.filter((t) => t.assigneeId === u.id).length,
    commentCount: commentCountForAuthor(u.id),
  })),
  null,
  2,
)};

// Derived from projectTasks so the workspace-wide list cannot drift
// from the per-project seed data.
export const allTasks: TaskWithProject[] = Object.entries(projectTasks).flatMap(
  ([projectId, projectTaskList]) => {
    const name =
      projects.find((project) => project.id === Number(projectId))?.name ?? "";

    return projectTaskList.map((task) => ({ ...task, projectName: name }));
  },
);
`;

const target = path.join(process.cwd(), "tests", "fixtures", "data.ts");

writeFileSync(target, generated);

console.log(
  `wrote ${target}: ${projects.length} projects, ${users.length} users, ${tasks.length} tasks, ${comments.length} comments`,
);
