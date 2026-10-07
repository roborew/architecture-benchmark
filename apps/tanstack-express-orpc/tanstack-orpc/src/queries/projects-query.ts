// src/queries/projects-query.ts
//
// The TanStack Query options for the projects surface. Declared once because
// the route loader (ensureQueryData) and the page component (useQuery) must
// share the exact same query key or the loader's prefetch would never be seen
// by the component.
//
// The options are the oRPC procedures' own option builders (src/orpc/client.ts):
// the key and the queryFn both come from the procedure, so the two cannot
// disagree. What stays here is the normalisation the API treats as one
// request: the board's filters drop every value that would not change the
// reply (an absent status, an empty one, a null cursor), so two spellings of
// the same request are one cache entry.

import { orpc } from "@/orpc/client";

/** The filters a project board's task list accepts. */
export type ProjectTaskQuery = {
  /** A single stored status, or absent for every status. */
  status?: string;
  /** The keyset cursor the previous page ended on; absent means the first page. */
  cursor?: string | null;
  /** Page size; the API clamps it to [1, 26] as the reference does. */
  limit?: number;
};

export function projectsQueryOptions(term = "") {
  return orpc.projects.list.queryOptions({
    input: { q: term || undefined },
  });
}

export function projectQueryOptions(id: number) {
  return orpc.projects.byId.queryOptions({ input: { id } });
}

export function projectTasksQueryOptions(
  projectId: number,
  filters: ProjectTaskQuery = {},
) {
  return orpc.projects.tasks.queryOptions({
    input: {
      id: projectId,
      status: filters.status || undefined,
      cursor: filters.cursor ?? undefined,
      limit: filters.limit ?? undefined,
    },
  });
}
