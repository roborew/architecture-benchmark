// src/queries/dashboard-query.ts
//
// The TanStack Query options for the dashboard aggregate. Declared once
// because the home route's loader (ensureQueryData) and its component
// (useQuery) must share the exact same query key or the loader's prefetch
// would never be seen by the component. The dashboard is one aggregate —
// stats, recent tasks and the busiest projects arrive together — so it is one
// cache entry with no parameters.

import { queryOptions } from "@tanstack/react-query";

import { getDashboard } from "@/api/dashboard";

export function dashboardQueryOptions() {
	return queryOptions({
		queryKey: ["dashboard"],
		queryFn: () => getDashboard(),
	});
}
