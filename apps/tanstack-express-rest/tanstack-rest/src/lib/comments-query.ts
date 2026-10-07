// src/lib/comments-query.ts
//
// The TanStack Query options for a task's comments. Declared once because the
// task detail's route loader (ensureQueryData) and its component (useQuery)
// must share the exact same query key or the loader's prefetch would never be
// seen by the component.

import { queryOptions } from "@tanstack/react-query";

import { getComments } from "@/api/comments";

export function commentsQueryOptions(taskId: number) {
	return queryOptions({
		queryKey: ["comments", { taskId }],
		queryFn: () => getComments(taskId),
	});
}
