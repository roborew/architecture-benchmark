// src/routes/users.index.tsx — the People list.
//
// The data flow is the TanStack Query + Router pattern: the loader warms the
// query cache (`ensureQueryData`) before the route renders, and the component
// reads the same query with `useQuery` — the identical options object
// (src/lib/users-query.ts) is what makes the two agree on the cache entry.
// The loader runs once per navigation; `useQuery` re-runs when the search
// param changes, so typing in the search field refreshes the table without a
// manual reload.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { UsersPage } from "@/components/users/users-page";
import { usersQueryOptions } from "@/lib/users-query";
import { parseUsersSearch } from "@/lib/users-search";

export const Route = createFileRoute("/users/")({
	validateSearch: parseUsersSearch,
	// Re-run the loader when the query changes, so the loader's prefetch
	// follows the search field.
	loaderDeps: ({ search }) => ({ q: search.q }),
	loader: ({ deps, context }) =>
		context.queryClient.ensureQueryData(usersQueryOptions(deps.q)),
	component: UsersRoute,
});

function UsersRoute() {
	const { q } = Route.useSearch();
	const { isPending, isError, error, data } = useQuery(usersQueryOptions(q));

	if (isPending) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">Loading people…</p>
			</div>
		);
	}

	if (isError) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">
					Could not load people: {error.message}
				</p>
			</div>
		);
	}

	return <UsersPage people={data} />;
}
