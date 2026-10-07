// src/lib/tasks-query.ts
//
// The TanStack Query options for the workspace-wide task list and its count
// aggregate. Declared once because the route loader (ensureQueryData) and the
// page component (useQuery) must share the exact same query key or the
// loader's prefetch would never be seen by the component.
//
// The key drops every value the request would drop: an absent filter and an
// empty one build the same URL, so they must be one cache entry — a loader
// prefetching `?q=` and a component reading no `q` at all would otherwise
// quietly miss each other.

import { queryOptions } from "@tanstack/react-query";

import {
	getTask,
	getTaskCount,
	getTasks,
	type TaskCountQuery,
	type TaskListQuery,
} from "@/api/tasks";

/** Removes the values that do not reach the URL, so the key matches the request. */
function keyPart(filters: TaskListQuery): Record<string, string | number> {
	const part: Record<string, string | number> = {};

	for (const [key, value] of Object.entries(filters)) {
		if (value !== undefined && value !== null && value !== "") {
			part[key] = value;
		}
	}

	return part;
}

export function tasksQueryOptions(filters: TaskListQuery = {}) {
	return queryOptions({
		queryKey: ["tasks", keyPart(filters)],
		queryFn: () => getTasks(filters),
	});
}

/** One task by id, with its project name; 404 surfaces as an ApiError. */
export function taskQueryOptions(id: number) {
	return queryOptions({
		queryKey: ["task", { id }],
		queryFn: () => getTask(id),
	});
}

/**
 * The count behind the list's summary line, as its own cache entry.
 *
 * A count is a separate aggregate on purpose (spec/queries.md): the list is a
 * bounded read, and the summary must not force the list to carry every
 * matching row. The count query takes no cursor and no limit, so its key is
 * only the filters — the same filters the list carries, minus the paging.
 */
export function taskCountQueryOptions(filters: TaskCountQuery = {}) {
	return queryOptions({
		queryKey: ["task-count", keyPart(filters)],
		queryFn: () => getTaskCount(filters),
	});
}
