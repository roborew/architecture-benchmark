// src/queries/users-query.ts
//
// The TanStack Query options for the users surface. Declared once because the
// route loader (ensureQueryData) and the page component (useQuery) must share
// the exact same query key or the loader's prefetch would never be seen by
// the component. The member's own row and her assigned tasks are separate
// entries — the detail page renders both, and a task list changing must not
// repaint the member's aggregate counts on every refetch.
//
// The options are the oRPC procedures' own option builders (src/orpc/client.ts):
// the key and the queryFn both come from the procedure, so the two cannot
// disagree. What stays here is the normalisation the API treats as one
// request: an absent term and an empty one are one input, so they must be one
// cache entry — a loader prefetching one and a component reading the other
// would otherwise quietly miss.

import { orpc } from "@/orpc/client";

export function usersQueryOptions(term = "") {
	return orpc.users.list.queryOptions({
		input: { q: term || undefined },
	});
}

export function userQueryOptions(id: number) {
	return orpc.users.byId.queryOptions({ input: { id } });
}

export function userTasksQueryOptions(id: number) {
	return orpc.users.tasks.queryOptions({ input: { id } });
}
