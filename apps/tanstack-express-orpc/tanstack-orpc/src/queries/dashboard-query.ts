// src/queries/dashboard-query.ts
//
// The TanStack Query options for the dashboard aggregate. Declared once
// because the home route's loader (ensureQueryData) and its component
// (useQuery) must share the exact same query key or the loader's prefetch
// would never be seen by the component. The dashboard is one aggregate —
// stats, recent tasks and the busiest projects arrive together — so it is one
// procedure call with no input and one cache entry.
//
// The options are the oRPC procedure's own option builders (src/orpc/client.ts):
// the key and the queryFn both come from the procedure, so the two cannot
// disagree.

import { orpc } from "@/orpc/client";

export function dashboardQueryOptions() {
	return orpc.dashboard.get.queryOptions();
}
