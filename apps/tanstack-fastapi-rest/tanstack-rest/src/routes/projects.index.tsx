// src/routes/projects.index.tsx — the workspace's project list.
//
// The data flow is the TanStack Query + Router pattern: the loader warms the
// query cache (`ensureQueryData`) before the route renders, and the component
// reads the same query with `useQuery` — the identical options object
// (src/queries/projects-query.ts) is what makes the two agree on the cache entry.
// The loader runs once per navigation; `useQuery` re-runs when the search
// param changes, so typing in the search field refreshes the table without a
// manual reload.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ProjectList } from "@/components/projects/project-list";
import {
	ProjectsError,
	ProjectsRouteError,
} from "@/components/projects/projects-error";
import { SearchInput } from "@/components/search-input";
import { parseProjectsSearch } from "@/lib/projects-search";
import { projectsQueryOptions } from "@/queries/projects-query";

export const Route = createFileRoute("/projects/")({
	validateSearch: parseProjectsSearch,
	// Re-run the loader when the query changes, so the loader's prefetch
	// follows the search field.
	loaderDeps: ({ search }) => ({ q: search.q }),
	loader: ({ deps, context }) =>
		context.queryClient.ensureQueryData(projectsQueryOptions(deps.q ?? "")),
	// A failed fetch renders HERE, inside the shell, rather than tearing the
	// route tree down to a blank screen (the router's CatchBoundary fallback).
	errorComponent: ProjectsRouteError,
	component: ProjectsPage,
});

function ProjectsPage() {
	const { q } = Route.useSearch();
	const { isPending, isError, error, data } = useQuery(
		projectsQueryOptions(q ?? ""),
	);

	if (isPending) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">Loading projects…</p>
			</div>
		);
	}

	if (isError) {
		// The loader already handled the first failure via errorComponent; this
		// guards a refetch that fails after a successful render.
		return <ProjectsError error={error} />;
	}

	const projects = data;

	return (
		<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
				<div>
					<p className="mb-2 text-[11px] font-medium text-slate-500">
						Workspace / Projects
					</p>
					<h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
						Projects
					</h1>
					<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
						Organise work into projects, then add and assign tasks within them.
					</p>
				</div>
				<Link
					to="/projects/new"
					className="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
				>
					＋ New project
				</Link>
			</div>

			<section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
				<div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
					<h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
						All projects
					</h2>
					<span className="text-[11px] text-slate-500">
						{projects.length} projects
					</span>
				</div>

				<div className="p-4">
					<SearchInput placeholder="Search projects…" label="Search projects" />
				</div>

				<ProjectList projects={projects} />
			</section>
		</div>
	);
}
