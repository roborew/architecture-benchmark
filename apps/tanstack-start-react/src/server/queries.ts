// src/server/queries.ts
//
// TanStack Start's equivalent of the Next.js Server Components that read the
// database directly.
//
// A route loader executes on the server for the initial request but in the
// browser during client navigation, so a loader must never call `src/lib/data`
// itself — that would ship the database connection to the client. Every read
// therefore goes through a `createServerFn`, which the router invokes on the
// server and serialises back to the browser.
//
// The functions here are intentionally thin: `src/lib/data.ts` remains the query
// layer and is exercised directly by the integration tests, so a behaviour
// change is attributable to one file rather than to a wrapper.

import { createServerFn } from "@tanstack/react-start";

import {
  countTasks,
  getComments,
  getDashboardProjects,
  getDashboardStats,
  getProject,
  getProjectTasks,
  getProjects,
  getRecentTasks,
  getTask,
  getTasks,
  getUser,
  getUserTasks,
  getUsers,
  type TaskFilters,
} from "@/lib/data";

export const fetchProjects = createServerFn({ method: "GET" })
  .validator((data: { q?: string } | undefined) => data ?? { q: "" })
  .handler(({ data }) => getProjects(data.q ?? ""));

export const fetchProject = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => data)
  .handler(({ data }) => getProject(data.id));

export const fetchProjectTasks = createServerFn({ method: "GET" })
  .validator(
    (data: {
      projectId: number;
      status?: string;
      cursor?: string | null;
      limit?: number;
    }) => data,
  )
  .handler(({ data }) => getProjectTasks(data.projectId, data));

export const fetchTasks = createServerFn({ method: "GET" })
  .validator((data: TaskFilters) => data)
  .handler(({ data }) => getTasks(data));

export const fetchTaskCount = createServerFn({ method: "GET" })
  .validator((data: TaskFilters) => data)
  .handler(({ data }) => countTasks(data));

export const fetchTask = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => data)
  .handler(({ data }) => getTask(data.id));

export const fetchComments = createServerFn({ method: "GET" })
  .validator((data: { taskId: number }) => data)
  .handler(({ data }) => getComments(data.taskId));

export const fetchDashboard = createServerFn({ method: "GET" }).handler(
  async () => {
    // Three independent aggregates, so they run concurrently rather than in
    // sequence.
    const [stats, recentTasks, projects] = await Promise.all([
      getDashboardStats(),
      getRecentTasks(),
      getDashboardProjects(),
    ]);

    return { stats, recentTasks, projects };
  },
);

export const fetchUsers = createServerFn({ method: "GET" })
  .validator((data: { q?: string } | undefined) => data ?? { q: "" })
  .handler(({ data }) => getUsers(data.q ?? ""));

export const fetchUser = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => data)
  .handler(({ data }) => getUser(data.id));

export const fetchUserTasks = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => data)
  .handler(({ data }) => getUserTasks(data.id));

/**
 * The Project and Assigned user selects, for the task form.
 *
 * One server function rather than two calls at the call site: they are always
 * needed together, and keeping the pairing here means the form pages do not
 * each re-derive it.
 */
export const fetchTaskFormOptions = createServerFn({ method: "GET" }).handler(
  async () => {
    const [projects, people] = await Promise.all([getProjects(), getUsers()]);

    return { projects, people };
  },
);
