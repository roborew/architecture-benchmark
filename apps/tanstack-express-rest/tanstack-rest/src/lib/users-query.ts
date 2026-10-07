// src/lib/users-query.ts
//
// The TanStack Query options for the users surface. Declared once because the
// route loader (ensureQueryData) and the page component (useQuery) must share
// the exact same query key or the loader's prefetch would never be seen by
// the component. The member's own row and her assigned tasks are separate
// entries — the detail page renders both, and a task list changing must not
// repaint the member's aggregate counts on every refetch.

import { queryOptions } from "@tanstack/react-query";

import { getUser, getUsers, getUserTasks } from "@/lib/api";

export function usersQueryOptions(term = "") {
	return queryOptions({
		queryKey: ["users", term ? { q: term } : {}],
		queryFn: () => getUsers(term),
	});
}

export function userQueryOptions(id: number) {
	return queryOptions({
		queryKey: ["user", { id }],
		queryFn: () => getUser(id),
	});
}

export function userTasksQueryOptions(id: number) {
	return queryOptions({
		queryKey: ["user-tasks", { id }],
		queryFn: () => getUserTasks(id),
	});
}
