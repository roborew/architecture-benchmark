// src/queries/comments-query.ts
//
// The TanStack Query options for a task's comments. Declared once because the
// task detail's route loader (ensureQueryData) and its component (useQuery)
// must share the exact same query key or the loader's prefetch would never be
// seen by the component.
//
// The options are the oRPC procedure's own option builders (src/orpc/client.ts):
// the key and the queryFn both come from the procedure, so the two cannot
// disagree.

import { orpc } from "@/orpc/client";

export function commentsQueryOptions(taskId: number) {
	return orpc.tasks.comments.queryOptions({ input: { id: taskId } });
}
