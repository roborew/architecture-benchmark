// The projects domain: handlers that pass straight through to the data layer.
//
// The counterpart to src/trpc/routers/projects.ts. See that file and
// src/orpc/contract.ts for why the contract/implement split exists; the
// behavioural contract is unchanged:
//
//   * The SQL, the validation and the `try`/`catch` all live in src/lib/data.ts.
//   * `.input()` checks the input's SHAPE, which is a client bug rather than user
//     error, so it surfaces as an error. Validating the VALUES is not here: a
//     blank name is rendered in the form and comes back as `{ ok: false, errors }`.

import {
  createProject,
  deleteProject,
  getDashboardProjects,
  getProject,
  getProjects,
  getProjectTasks,
  updateProject,
} from "@/lib/data";
import { implement } from "@orpc/server";
import { projectsContract } from "../contract";

const os = implement(projectsContract);

export const listProjects = os.list.handler(({ input }) =>
  getProjects(input?.search ?? ""),
);

export const getProjectById = os.byId.handler(({ input }) => getProject(input.id));

export const listDashboardProjects = os.dashboard.handler(({ input }) =>
  getDashboardProjects(input?.limit),
);

export const listProjectTasks = os.tasks.handler(({ input }) =>
  getProjectTasks(input.id, {
    status: input.status,
    cursor: input.cursor ?? null,
    limit: input.limit,
  }),
);

export const createNewProject = os.create.handler(({ input }) => createProject(input));

export const updateExistingProject = os.update.handler(({ input }) =>
  updateProject(input),
);

export const deleteExistingProject = os.delete.handler(({ input }) =>
  deleteProject(input.id),
);

export const projectsRouter = os.router({
  list: listProjects,
  byId: getProjectById,
  dashboard: listDashboardProjects,
  tasks: listProjectTasks,
  create: createNewProject,
  update: updateExistingProject,
  delete: deleteExistingProject,
});
