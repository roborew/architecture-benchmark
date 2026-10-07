// src/routes/users.$id.index.tsx — one workspace member.
//
// The data flow is the TanStack Query + Router pattern: the loader warms the
// member's own row and her assigned tasks (`ensureQueryData`) before the route
// renders, and the component reads the same queries with `useQuery` — the
// identical options objects (src/lib/users-query.ts) are what make the two
// agree on the cache entries. The second read is keyed on the first one's
// result, exactly as the reference variant's two-step lookup was.
//
// The not-found outcome is a rendered state rather than `notFound()`, because
// that is what the reference variant does: the loader returns null for an id
// that matches no row (or is not a number at all) and the component renders
// the inline block with a way back to the list.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { UserDetail } from "@/components/users/user-detail";
import { UsersError, UsersRouteError } from "@/components/users/users-error";
import { ApiError } from "@/lib/api";
import { userQueryOptions, userTasksQueryOptions } from "@/lib/users-query";

export const Route = createFileRoute("/users/$id/")({
	loader: async ({ params, context }) => {
		// Scoped by id rather than by display name: a name-keyed lookup would
		// give two members sharing a name each other's tasks.
		const personId = Number(params.id);

		if (!Number.isInteger(personId)) return null;

		try {
			await context.queryClient.ensureQueryData(userQueryOptions(personId));
		} catch (error) {
			// The API answers 404 for a missing row; that is the not-found state
			// the component renders, not an error page. Anything else (the API
			// unreachable, a 5xx) is a real error and propagates to the
			// errorComponent.
			if (error instanceof ApiError && error.status === 404) return null;
			throw error;
		}

		await context.queryClient.ensureQueryData(userTasksQueryOptions(personId));
	},
	// A failed fetch renders HERE, inside the shell, rather than tearing the
	// route tree down to a blank screen (the router's CatchBoundary fallback).
	errorComponent: UsersRouteError,
	component: UserDetailRoute,
});

/** The member page's inline not-found state, mirroring the reference's. */
function UserNotFound() {
	return (
		<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
				Person not found
			</h1>
			<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
				No workspace member matches that id.
			</p>
			<Link
				to="/users"
				className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
			>
				Back to People
			</Link>
		</div>
	);
}

function UserDetailRoute() {
	const { id } = Route.useParams();

	// `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
	// row, so both paths land on the not-found state below.
	const personId = Number(id);
	const isValid = Number.isInteger(personId);

	// The queries are declared unconditionally (hooks cannot be called
	// conditionally); an invalid id leaves them disabled, so nothing is fetched
	// for a URL the member page cannot answer.
	const personQuery = useQuery({
		...userQueryOptions(personId),
		enabled: isValid,
	});
	const tasksQuery = useQuery({
		...userTasksQueryOptions(personId),
		enabled: isValid,
	});

	if (!isValid) {
		return <UserNotFound />;
	}

	if (personQuery.isPending || tasksQuery.isPending) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">Loading person…</p>
			</div>
		);
	}

	if (personQuery.isError) {
		// A 404 from the API is the same not-found state the loader mapped to
		// null: the component guards a refetch that fails after a successful
		// render (the member was deleted in another tab).
		if (
			personQuery.error instanceof ApiError &&
			personQuery.error.status === 404
		) {
			return <UserNotFound />;
		}

		return <UsersError error={personQuery.error} />;
	}

	if (tasksQuery.isError) {
		return <UsersError error={tasksQuery.error} />;
	}

	return <UserDetail person={personQuery.data} tasks={tasksQuery.data} />;
}
