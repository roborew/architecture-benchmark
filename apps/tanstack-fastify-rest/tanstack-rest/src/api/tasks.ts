// src/api/tasks.ts
//
// How the SPA talks to the server about tasks: the workspace list and its
// filters, one task by id, the mutations its forms submit, and the atomic
// create-with-comment path. Comments on an existing task live in
// `comments.ts`. Transport details (the base URL, the error envelope, the
// JSON handling) live in `api/api.ts`.

import type { TaskRow, TaskWithProject } from "@/lib/types";
import {
	type FormValues,
	type MutationResult,
	requestJson,
	send,
	toQuery,
} from "./api";

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

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

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
