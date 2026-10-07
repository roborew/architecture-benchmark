// src/lib/tasks-query.ts
//
// The TanStack Query options for the workspace-wide task list. Declared once
// because the route loader (ensureQueryData) and the page component (useQuery)
// must share the exact same query key or the loader's prefetch would never be
// seen by the component.
//
// The key drops every value the request would drop: an absent filter and an
// empty one build the same URL, so they must be one cache entry — a loader
// prefetching `?q=` and a component reading no `q` at all would otherwise
// quietly miss each other.

import { queryOptions } from "@tanstack/react-query";

import { getTasks, type TaskListQuery } from "@/lib/api";

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
