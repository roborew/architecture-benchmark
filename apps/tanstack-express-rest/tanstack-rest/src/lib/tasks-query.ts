// src/lib/users-query.ts
//
// The TanStack Query options for the users listing. Declared once because the
// route loader (ensureQueryData) and the page component (useQuery) must share
// the exact same query key or the loader's prefetch would never be seen by
// the component.

import { queryOptions } from "@tanstack/react-query";
import { getTasks } from "./api";

export function tasksQueryOptions(term = "") {
  return queryOptions({
    queryKey: ["tasks", { q: term }],
    queryFn: () => getTasks(term),
  });
}
