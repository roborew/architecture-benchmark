// src/lib/projects-query.ts
//
// The TanStack Query options for the projects surface. Declared once because
// the route loader (ensureQueryData) and the page component (useQuery) must
// share the exact same query key or the loader's prefetch would never be seen
// by the component. The board options key by the project id plus every filter
// that builds the request, so two filter sets that build the same URL are one
// cache entry.

import { queryOptions } from "@tanstack/react-query";

import { getProject, getProjectTasks, getProjects, type ProjectTaskQuery } from "@/lib/api";

/** Removes the values that do not reach the URL, so the key matches the request. */
function keyPart(filters: ProjectTaskQuery): Record<string, string | number> {
	const part: Record<string, string | number> = {};

	for (const [key, value] of Object.entries(filters)) {
		if (value !== undefined && value !== null && value !== "") {
			part[key] = value;
		}
	}

	return part;
}

export function projectsQueryOptions(term = "") {
	return queryOptions({
		queryKey: ["projects", term ? { q: term } : {}],
		queryFn: () => getProjects(term),
	});
}

export function projectQueryOptions(id: number) {
	return queryOptions({
		queryKey: ["project", { id }],
		queryFn: () => getProject(id),
	});
}

export function projectTasksQueryOptions(projectId: number, filters: ProjectTaskQuery = {}) {
	return queryOptions({
		queryKey: ["project-tasks", projectId, keyPart(filters)],
		queryFn: () => getProjectTasks(projectId, filters),
	});
}
