// The tasks domain: handlers that pass straight through to the data layer.
//
// The counterpart to src/trpc/routers/tasks.ts. See that file and
// src/orpc/contract.ts for why the contract/implement split exists; the
// behavioural contract is unchanged.
//
// Two shape rules are doing real work, and both now live in the contract rather
// than in this module:
//
//   * `assigneeId` is `null`-able and never optional-only, because
//     spec/contract.md gives exactly one way to unassign. `null` means
//     "unassigned"; the data layer normalises an absent value to it.
//   * `update` has no `projectId` at all. The contract lists the update form's
//     fields as title, status, assignee and description only, so accepting one
//     would allow moving a task behind a form that never offers the choice.

import {
  countTasks,
  createTask,
  createTaskWithComment,
  deleteTask,
  getComments,
  getDashboardStats,
  getRecentTasks,
  getTask,
  getTasks,
  updateTask,
} from "@/lib/data";
import { implement } from "@orpc/server";
import { tasksContract } from "../contract";

const os = implement(tasksContract);

export const listTasks = os.list.handler(({ input }) =>
  getTasks({
    search: input.search,
    status: input.status,
    projectId: input.projectId,
    assigneeId: input.assigneeId,
    cursor: input.cursor ?? null,
    limit: input.limit,
  }),
);

export const countMatchingTasks = os.count.handler(({ input }) => countTasks(input));

export const getTaskById = os.byId.handler(({ input }) => getTask(input.id));

export const listTaskComments = os.comments.handler(({ input }) =>
  getComments(input.id, input.limit),
);

export const getWorkspaceStats = os.dashboardStats.handler(() => getDashboardStats());

export const listRecentTasks = os.recent.handler(({ input }) =>
  getRecentTasks(input?.limit),
);

export const createNewTask = os.create.handler(({ input }) => createTask(input));

export const updateExistingTask = os.update.handler(({ input }) => updateTask(input));

export const deleteExistingTask = os.delete.handler(({ input }) => deleteTask(input.id));

export const createTaskAndComment = os.createWithComment.handler(({ input }) =>
  createTaskWithComment(input),
);

export const tasksRouter = os.router({
  list: listTasks,
  count: countMatchingTasks,
  byId: getTaskById,
  comments: listTaskComments,
  dashboardStats: getWorkspaceStats,
  recent: listRecentTasks,
  create: createNewTask,
  update: updateExistingTask,
  delete: deleteExistingTask,
  createWithComment: createTaskAndComment,
});
