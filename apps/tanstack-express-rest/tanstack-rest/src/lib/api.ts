// src/lib/api.ts
//
// The fetch client for the Express backend. Every call goes through here so
// the base URL, the error envelope, and the JSON handling are decided in
// exactly one place — this file is the SPA's only copy of the REST contract
// (apps/tanstack-express-rest/express-rest/README.md).
//
// Reads build query params from plain filter objects; the API treats an
// absent param and an empty one the same way, so absent filters are simply
// omitted. Mutations send the form's fields as a JSON body, passing them
// through untouched: the server owns every normalisation rule (an empty
// assignee means "unassigned", a numeric string is a row id), so the client
// cannot disagree with itself about how a value is spelled.

import type {
  Comment,
  DashboardData,
  Project,
  ProjectTaskRow,
  TaskRow,
  TaskWithProject,
  User,
} from "@/lib/types";

/** Where the Express API lives. Overridable per environment (e2e points it at its own server). */
export const API_URL: string =
  import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * A failure the API reported deliberately.
 *
 * `message` is the user-visible string from the API's `{ error }` envelope;
 * `errors` is the field → messages map a 400 carries, keyed exactly as the
 * API's validators key it. A network-level failure (fetch itself rejecting)
 * is not an ApiError — there is no status to report, only the browser's
 * generic message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: Record<string, string[]>;

  constructor(
    status: number,
    message: string,
    errors: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);

  if (!response.ok) {
    // The API's error envelope is { error, errors? }, but a proxy or a crash
    // can hand back anything; the status is the only guaranteed fact.
    let message = `Request failed with ${response.status}`;
    let errors: Record<string, string[]> = {};

    try {
      const body = (await response.json()) as {
        error?: string;
        errors?: Record<string, string[]>;
      };
      if (body && typeof body.error === "string") {
        message = body.error;
      }
      if (body?.errors && typeof body.errors === "object") {
        errors = body.errors;
      }
    } catch {
      // Not JSON — keep the status-based message.
    }

    throw new ApiError(response.status, message, errors);
  }

  return response.json() as Promise<T>;
}

/**
 * Builds a query string from defined values only.
 *
 * `undefined`, `null` and `""` are all "no filter": the API resolves each to
 * the same default, and a URL that says so explicitly (`?status=`) is noise
 * over the bare path.
 */
function toQuery(
  filters: Record<string, string | number | undefined | null>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }

  const query = params.toString();

  return query ? `?${query}` : "";
}

/** A POST/PATCH/DELETE with a JSON body; the mutations all share this shape. */
function send<T>(path: string, method: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The projects listing. An empty term returns every project; a term filters
 * server-side (ILIKE on name and description).
 */
export function getProjects(term = ""): Promise<Project[]> {
  return requestJson<Project[]>(`/api/projects${toQuery({ q: term })}`);
}

/** One project by id; the API answers 404 with an ApiError when none matches. */
export function getProject(id: number): Promise<Project> {
  return requestJson<Project>(`/api/projects/${id}`);
}

/** The filters a project board's task list accepts. */
export type ProjectTaskQuery = {
  /** A single stored status, or absent for every status. */
  status?: string;
  /** The keyset cursor the previous page ended on; absent means the first page. */
  cursor?: string | null;
  /** Page size; the API clamps it to [1, 26] as the reference does. */
  limit?: number;
};

/**
 * One page of a project's board tasks, newest first. Rows carry `cursorFor` —
 * the opaque tuple the next page starts after — so the caller can page without
 * a second query.
 */
export function getProjectTasks(
  projectId: number,
  filters: ProjectTaskQuery = {},
): Promise<ProjectTaskRow[]> {
  return requestJson<ProjectTaskRow[]>(
    `/api/projects/${projectId}/tasks${toQuery(filters)}`,
  );
}

/** The filters the workspace-wide task list accepts. */
export type TaskListQuery = {
  /** Searches title and description. */
  q?: string;
  /** A single stored status, or absent for every status. */
  status?: string;
  projectId?: number;
  assigneeId?: number;
  /** The keyset cursor the previous page ended on; absent means the first page. */
  cursor?: string | null;
  /** Page size; the API clamps it to [1, 26] as the reference does. */
  limit?: number;
};

/**
 * The workspace-wide task list, newest updated first. An empty filter object
 * returns the first page of every task.
 */
export function getTasks(filters: TaskListQuery = {}): Promise<TaskRow[]> {
  return requestJson<TaskRow[]>(`/api/tasks${toQuery(filters)}`);
}

/** The filters `getTaskCount` accepts — a count has no paging. */
export type TaskCountQuery = Omit<TaskListQuery, "cursor" | "limit">;

/**
 * How many tasks match the filters. A separate aggregate from the list on
 * purpose (spec/queries.md): the count backs the summary line, and the list
 * stays a bounded read.
 */
export function getTaskCount(filters: TaskCountQuery = {}): Promise<number> {
  return requestJson<{ count: number }>(
    `/api/tasks/count${toQuery(filters)}`,
  ).then((body) => body.count);
}

/** One task by id, with its project name; 404 surfaces as an ApiError. */
export function getTask(id: number): Promise<TaskWithProject> {
  return requestJson<TaskWithProject>(`/api/tasks/${id}`);
}

/** The 10 most recent comments on one task, newest first. */
export function getComments(taskId: number): Promise<Comment[]> {
  return requestJson<Comment[]>(`/api/tasks/${taskId}/comments`);
}

/**
 * The People listing rows. An empty term returns every member; a term filters
 * server-side (ILIKE on name and email).
 */
export function getUsers(term = ""): Promise<User[]> {
  return requestJson<User[]>(`/api/users${toQuery({ q: term })}`);
}

/** One member by id; 404 surfaces as an ApiError. */
export function getUser(id: number): Promise<User> {
  return requestJson<User>(`/api/users/${id}`);
}

/** The tasks assigned to one member, newest first. */
export function getUserTasks(id: number): Promise<TaskWithProject[]> {
  return requestJson<TaskWithProject[]>(`/api/users/${id}/tasks`);
}

/** The dashboard aggregate: stats, recent tasks and the busiest projects. */
export function getDashboard(): Promise<DashboardData> {
  return requestJson<DashboardData>("/api/dashboard");
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * What a form submits, exactly as the form collected it.
 *
 * Every value is a string (that is what a form control produces) and the
 * server owns every coercion — the API's validators are the reference
 * variant's zod schemas, which accept the form's spelling verbatim.
 */
export type FormValues = Record<string, string>;

/**
 * The API's outcome envelope.
 *
 * `redirectTo` is the route the reference variant navigates to after the same
 * mutation; `message` is the user-visible success string. A reply without a
 * `redirectTo` (adding a comment) means: stay on this page and refresh.
 */
export type MutationResult = {
  ok: true;
  message?: string;
  redirectTo?: string;
};

// --- Projects ---

export function createProject(values: FormValues): Promise<MutationResult> {
  return send("/api/projects", "POST", values);
}

export function updateProject(
  id: number,
  values: FormValues,
): Promise<MutationResult> {
  return send(`/api/projects/${id}`, "PATCH", values);
}

export function deleteProject(id: number): Promise<MutationResult> {
  return send(`/api/projects/${id}`, "DELETE", undefined);
}

// --- Users ---

export function createUser(values: FormValues): Promise<MutationResult> {
  return send("/api/users", "POST", values);
}

export function updateUser(
  id: number,
  values: FormValues,
): Promise<MutationResult> {
  return send(`/api/users/${id}`, "PATCH", values);
}

export function deleteUser(id: number): Promise<MutationResult> {
  return send(`/api/users/${id}`, "DELETE", undefined);
}

// --- Tasks ---

export function createTask(values: FormValues): Promise<MutationResult> {
  return send("/api/tasks", "POST", values);
}

export function updateTask(
  id: number,
  values: FormValues,
): Promise<MutationResult> {
  return send(`/api/tasks/${id}`, "PATCH", values);
}

export function deleteTask(id: number): Promise<MutationResult> {
  return send(`/api/tasks/${id}`, "DELETE", undefined);
}

/** The atomic create: the task and its first comment are written together. */
export function createTaskWithComment(
  values: FormValues,
): Promise<MutationResult> {
  return send("/api/tasks/with-comment", "POST", values);
}

/**
 * Adds a comment to an existing task.
 *
 * The field names are this endpoint's own (`body`/`authorId`), not the
 * reference form's (`commentBody`/`commentAuthorId`): the API keys its
 * validation errors by the names the request actually sent, so the form that
 * renders those errors must submit the same spelling.
 */
export function createComment(
  taskId: number,
  values: FormValues,
): Promise<MutationResult> {
  return send(`/api/tasks/${taskId}/comments`, "POST", values);
}
