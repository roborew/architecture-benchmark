// src/api/tasks.ts
//
// How the SPA talks to the server about tasks: the workspace list and its
// filters, one task by id, the mutations its forms submit, and the atomic
// create-with-comment path. Comments on an existing task live in
// `comments.ts`. Transport details (the endpoint, the error envelope, the
// response handling) live in `api/api.ts`.
//
// The documents select exactly the fields the pages render; the mutations
// declare the form's fields as String variables — the server owns every
// coercion rule, so the field bag travels untouched.

import type { TaskRow, TaskWithProject } from "@/lib/types";
import { type FormValues, type MutationResult, request } from "./api";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

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

const TASKS_QUERY = /* GraphQL */ `
  query Tasks(
    $q: String
    $status: String
    $projectId: Int
    $assigneeId: Int
    $cursor: String
    $limit: Int
  ) {
    tasks(
      q: $q
      status: $status
      projectId: $projectId
      assigneeId: $assigneeId
      cursor: $cursor
      limit: $limit
    ) {
      id
      projectId
      projectName
      title
      description
      status
      assigneeName
      commentCount
      updatedAt
      updatedAtRaw
      cursorFor
    }
  }
`;

/**
 * The workspace-wide task list, newest updated first. An empty filter object
 * returns the first page of every task. An absent filter and an empty one are
 * the same request (JSON drops the undefined key), so the query key the
 * options build stays one cache entry either way.
 */
export function getTasks(filters: TaskListQuery = {}): Promise<TaskRow[]> {
	return request<{ tasks: TaskRow[] }>(TASKS_QUERY, filters).then(
		(data) => data.tasks,
	);
}

/** The filters `getTaskCount` accepts — a count has no paging. */
export type TaskCountQuery = Omit<TaskListQuery, "cursor" | "limit">;

const TASK_COUNT_QUERY = /* GraphQL */ `
  query TaskCount(
    $q: String
    $status: String
    $projectId: Int
    $assigneeId: Int
  ) {
    taskCount(
      q: $q
      status: $status
      projectId: $projectId
      assigneeId: $assigneeId
    )
  }
`;

/**
 * How many tasks match the filters. A separate aggregate from the list on
 * purpose (spec/queries.md): the count backs the summary line, and the list
 * stays a bounded read.
 */
export function getTaskCount(filters: TaskCountQuery = {}): Promise<number> {
	return request<{ taskCount: number }>(TASK_COUNT_QUERY, filters).then(
		(data) => data.taskCount,
	);
}

const TASK_QUERY = /* GraphQL */ `
  query Task($id: Int!) {
    task(id: $id) {
      id
      projectId
      projectName
      title
      description
      status
      assigneeName
      commentCount
      updatedAt
    }
  }
`;

/** One task by id, with its project name; a missing row surfaces as an ApiError. */
export function getTask(id: number): Promise<TaskWithProject> {
	return request<{ task: TaskWithProject }>(TASK_QUERY, { id }).then(
		(data) => data.task,
	);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const CREATE_TASK_MUTATION = /* GraphQL */ `
  mutation CreateTask(
    $projectId: String
    $assigneeId: String
    $title: String
    $description: String
    $status: String
  ) {
    createTask(
      projectId: $projectId
      assigneeId: $assigneeId
      title: $title
      description: $description
      status: $status
    ) {
      ok
      message
      redirectTo
    }
  }
`;

export function createTask(values: FormValues): Promise<MutationResult> {
	return request<{ createTask: MutationResult }>(
		CREATE_TASK_MUTATION,
		values,
	).then((data) => data.createTask);
}

const UPDATE_TASK_MUTATION = /* GraphQL */ `
  mutation UpdateTask(
    $id: Int!
    $title: String
    $description: String
    $status: String
    $assigneeId: String
  ) {
    updateTask(
      id: $id
      title: $title
      description: $description
      status: $status
      assigneeId: $assigneeId
    ) {
      ok
      message
      redirectTo
    }
  }
`;

export function updateTask(
	id: number,
	values: FormValues,
): Promise<MutationResult> {
	return request<{ updateTask: MutationResult }>(UPDATE_TASK_MUTATION, {
		id,
		...values,
	}).then((data) => data.updateTask);
}

const DELETE_TASK_MUTATION = /* GraphQL */ `
  mutation DeleteTask($id: Int!) {
    deleteTask(id: $id) {
      ok
      message
      redirectTo
    }
  }
`;

export function deleteTask(id: number): Promise<MutationResult> {
	return request<{ deleteTask: MutationResult }>(DELETE_TASK_MUTATION, {
		id,
	}).then((data) => data.deleteTask);
}

const CREATE_TASK_WITH_COMMENT_MUTATION = /* GraphQL */ `
  mutation CreateTaskWithComment(
    $projectId: String
    $assigneeId: String
    $title: String
    $description: String
    $status: String
    $commentBody: String
    $commentAuthorId: String
  ) {
    createTaskWithComment(
      projectId: $projectId
      assigneeId: $assigneeId
      title: $title
      description: $description
      status: $status
      commentBody: $commentBody
      commentAuthorId: $commentAuthorId
    ) {
      ok
      message
      redirectTo
    }
  }
`;

/** The atomic create: the task and its first comment are written together. */
export function createTaskWithComment(
	values: FormValues,
): Promise<MutationResult> {
	return request<{ createTaskWithComment: MutationResult }>(
		CREATE_TASK_WITH_COMMENT_MUTATION,
		values,
	).then((data) => data.createTaskWithComment);
}
