// src/lib/users-query.ts
//
// The TanStack Query options for the users listing. Declared once because the
// route loader (ensureQueryData) and the page component (useQuery) must share
// the exact same query key or the loader's prefetch would never be seen by
// the component.

import { queryOptions } from "@tanstack/react-query";

import { getUsers } from "@/lib/api";

export function usersQueryOptions(term = "") {
	return queryOptions({
		queryKey: ["users", { q: term }],
		queryFn: () => getUsers(term),
	});
}
