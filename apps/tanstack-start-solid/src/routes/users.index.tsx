// src/routes/users.index.tsx — the People list.
//
// The Next.js page read `searchParams.q` and called `getUsers` directly. Here
// the search param is validated once at the route boundary and the read happens
// in a loader calling a server function, so the same code runs on the server for
// the first request and in the browser during client navigation.

import { createFileRoute, Link } from "@tanstack/solid-router";

import { SearchInput } from "@/components/search-input";
import { UserTable } from "@/components/users/user-table";
import { fetchUsers } from "@/server/queries";

export const Route = createFileRoute("/users/")({
	// `q` is typed optional so that a plain `<Link to="/users">` stays valid
	// without every caller having to pass `search`. Absent resolves to
	// `undefined` rather than "" so the bare URL stays /users, and numeric
	// values are coerced because TanStack's default search parsing is
	// JSON-based: ?q=5 arrives as the number 5.
	validateSearch: (search: Record<string, unknown>): { q?: string } => ({
		q:
			typeof search.q === "string"
				? search.q
				: typeof search.q === "number" && Number.isFinite(search.q)
					? String(search.q)
					: undefined,
	}),
	// Re-run the loader when the query changes, so typing in the search field
	// refreshes the table without a manual reload.
	loaderDeps: ({ search }) => ({ q: search.q }),
	loader: ({ deps }) => fetchUsers({ data: { q: deps.q } }),
	component: UsersPage,
});

function UsersPage() {
	const people = Route.useLoaderData();

	return (
		<div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
				<div>
					<p class="mb-2 text-[11px] font-medium text-slate-500">
						Workspace / People
					</p>
					<h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
						People
					</h1>
					<p class="mt-1.5 text-[13px] leading-6 text-slate-500">
						Manage workspace members who are assigned tasks and author comments.
					</p>
				</div>
				<Link
					to="/users/new"
					class="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
				>
					＋ New user
				</Link>
			</div>

			<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
				<div class="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
					<h2 class="text-[15px] font-bold tracking-[-.02em] text-slate-800">
						Workspace members
					</h2>
					<span class="text-[11px] text-slate-500">
						{people().length} people
					</span>
				</div>
				<div class="p-4">
					{/* No Suspense boundary is needed here. Next required one because
              `useSearchParams` opts a subtree out of static rendering; the
              search param is read through the route's `validateSearch`, and
              SearchInput pushes it with the router rather than reading it. */}
					<SearchInput placeholder="Search people…" label="Search people" />
				</div>
				<UserTable people={people()} />
			</section>
		</div>
	);
}
