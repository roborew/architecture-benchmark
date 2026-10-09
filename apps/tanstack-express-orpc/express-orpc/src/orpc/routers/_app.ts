// src/orpc/routers/_app.ts
//
// The application router: every domain, assembled in one place.
//
// `os` here comes from the plain router builder, not an implementer, because
// it takes already-implemented routers rather than contracts. Each domain's
// own file used `implement(itsContract)`; this file only composes the results.
//
// `createApp` (src/app.ts) passes each domain its model here — the composition
// root is still the only place the dependency chain (connection → models →
// routers) is wired.

import { os } from "@orpc/server";

import type { DashboardModel } from "../../dashboard/dashboard.model.ts";
import type { ProjectsModel } from "../../projects/projects.model.ts";
import type { TasksModel } from "../../tasks/tasks.model.ts";
import type { UsersModel } from "../../users/users.model.ts";
import {
  dashboardContract,
  projectsContract,
  tasksContract,
  usersContract,
} from "../contract.ts";
import { createDashboardRouter } from "./dashboard.ts";
import { createProjectsRouter } from "./projects.ts";
import { createTasksRouter } from "./tasks.ts";
import { createUsersRouter } from "./users.ts";

export interface AppRouterDeps {
  users: UsersModel;
  tasks: TasksModel;
  projects: ProjectsModel;
  dashboard: DashboardModel;
}

export function createAppRouter(deps: AppRouterDeps) {
  return os.router({
    users: createUsersRouter(deps.users),
    tasks: createTasksRouter(deps.tasks),
    projects: createProjectsRouter(deps.projects),
    dashboard: createDashboardRouter(deps.dashboard),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/**
 * The contract object as a whole.
 *
 * Not needed by the RPC client — a client typed against `AppRouter` works —
 * but this is what an `OpenAPIGenerator` consumes, so it is assembled from the
 * same per-domain contracts the implementations are checked against. The SPA's
 * mirrored contract (../tanstack-orpc/src/orpc/contract.ts) mirrors this shape
 * exactly.
 */
export const contract = {
  users: usersContract,
  tasks: tasksContract,
  projects: projectsContract,
  dashboard: dashboardContract,
};

export type AppContract = typeof contract;
