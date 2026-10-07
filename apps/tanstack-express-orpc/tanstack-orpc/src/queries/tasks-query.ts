// src/queries/tasks-query.ts
//
// The TanStack Query options for the workspace-wide task list and its count
// aggregate. Declared once because the route loader (ensureQueryData) and the
// page component (useQuery) must share the exact same query key or the
// loader's prefetch would never be seen by the component.
//
// The options are the oRPC procedures' own option builders (src/orpc/client.ts):
// the key and the queryFn both come from the procedure, so the two cannot
// disagree. What stays here is the normalisation the API treats as one
// request: every value that would not change the reply (an absent filter, an
// empty one, a null cursor) is dropped from the input, so two spellings of
// the same request are one cache entry — a loader prefetching one and a
// component reading the other would otherwise quietly miss.

import { orpc } from "@/orpc/client";

/** The filters the workspace-wide task list accepts, as the SPA spells them. */
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

/** Removes the values that do not reach the request, so the key matches it. */
function input(filters: TaskListQuery) {
  return {
    q: filters.q || undefined,
    status: filters.status || undefined,
    projectId: filters.projectId ?? undefined,
    assigneeId: filters.assigneeId ?? undefined,
    cursor: filters.cursor ?? undefined,
    limit: filters.limit ?? undefined,
  };
}

export function tasksQueryOptions(filters: TaskListQuery = {}) {
  return orpc.tasks.list.queryOptions({ input: input(filters) });
}

/** One task by id, with its project name; a missing row rejects as NOT_FOUND. */
export function taskQueryOptions(id: number) {
  return orpc.tasks.byId.queryOptions({ input: { id } });
}

/**
 * The count behind the list's summary line, as its own cache entry.
 *
 * A count is a separate aggregate on purpose (spec/queries.md): the list is a
 * bounded read, and the summary must not force the list to carry every
 * matching row. The count query takes no cursor and no limit, so its input is
 * only the filters — the same filters the list carries, minus the paging.
 */
export function taskCountQueryOptions(filters: TaskListQuery = {}) {
  const { cursor: _cursor, limit: _limit, ...rest } = filters;

  return orpc.tasks.count.queryOptions({ input: input(rest) });
}
