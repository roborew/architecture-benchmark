// src/routes/users.$id.edit.tsx — the edit-user form.
//
// The data flow is the TanStack Query + Router pattern: the loader warms the
// member's own row (`ensureQueryData`) before the route renders, and the
// component reads the same query with `useQuery` — the identical options
// object (src/queries/users-query.ts) is what makes the two agree on the cache
// entry.
//
// A missing member is `notFound()`, thrown by the loader, with the same markup
// registered as the route's `notFoundComponent` — mirroring the reference
// variant exactly: an inline-looking block with the contract's `not-found`
// testid. Throwing rather than returning matters: it unwinds the loader, so
// nothing renders on a bad id.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ApiError } from "@/api/api";
import { UserForm } from "@/components/users/user-form";
import { UsersError, UsersRouteError } from "@/components/users/users-error";
import { userQueryOptions } from "@/queries/users-query";

export const Route = createFileRoute("/users/$id/edit")({
	loader: async ({ params, context }) => {
		// `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
		// row, so both paths land on the not-found page.
		const personId = Number(params.id);

		if (!Number.isInteger(personId)) {
			throw notFound();
		}

		try {
			await context.queryClient.ensureQueryData(userQueryOptions(personId));
		} catch (error) {
			// The API answers 404 for a missing row: the same not-found page the
			// NaN id produced. Anything else (the API unreachable, a 5xx) is a
			// real error and propagates to the errorComponent.
			if (error instanceof ApiError && error.status === 404) throw notFound();
			throw error;
		}
	},
	notFoundComponent: UserNotFound,
	// A failed fetch renders HERE, inside the shell, rather than tearing the
	// route tree down to a blank screen (the router's CatchBoundary fallback).
	errorComponent: UsersRouteError,
	component: EditUserPage,
});

function EditUserPage() {
	const { id } = Route.useParams();

	const { isPending, isError, error, data } = useQuery(
		userQueryOptions(Number(id)),
	);

	if (isPending) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">Loading person…</p>
			</div>
		);
	}

	if (isError) {
		// The loader already mapped the first 404 to the not-found page; this
		// guards a refetch that fails after a successful render.
		if (error instanceof ApiError && error.status === 404) {
			return <UserNotFound />;
		}

		return <UsersError error={error} />;
	}

	return <UserForm person={data} />;
}

function UserNotFound() {
	return (
		<div data-testid="not-found">
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
		</div>
	);
}
