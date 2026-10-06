// src/routes/projects.index.tsx — the workspace's project list.
//
// The Next.js page was an async Server Component that read the database
// directly. Here the read happens in a loader calling a server function: a
// loader runs on the server for the first request *and in the browser* during
// client navigation, so it must never touch the database itself.

import { createFileRoute, Link } from "@tanstack/solid-router";

import { ProjectList } from "@/components/projects/project-list";
import { SearchInput } from "@/components/search-input";
import { fetchProjects } from "@/server/queries";

export const Route = createFileRoute("/projects/")({
	// Typed as optional so a `<Link to="/projects">` elsewhere does not have to
	// pass a `search` object. Absent resolves to `undefined` rather than "" so
	// the bare URL stays /projects — an empty string would be serialised by
	// TanStack as /projects?q=. Numeric values are coerced too: TanStack's
	// default search parsing JSON-parses, so ?q=5 arrives as the number 5.
	validateSearch: (search: Record<string, unknown>): { q?: string } => ({
		q:
			typeof search.q === "string"
				? search.q
				: typeof search.q === "number" && Number.isFinite(search.q)
					? String(search.q)
					: undefined,
	}),
	loaderDeps: ({ search }) => ({ ...search }),
	loader: ({ deps }) => fetchProjects({ data: { q: (deps.q ?? "").trim() } }),
	component: ProjectsPage,
});

function ProjectsPage() {
	const projects = Route.useLoaderData();

	return (
		<div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
				<div>
					<p class="mb-2 text-[11px] font-medium text-slate-500">
						Workspace / Projects
					</p>
					<h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
						Projects
					</h1>
					<p class="mt-1.5 text-[13px] leading-6 text-slate-500">
						Organise work into projects, then add and assign tasks within them.
					</p>
				</div>
				<Link
					to="/projects/new"
					class="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
				>
					＋ New project
				</Link>
			</div>

			<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
				<div class="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
					<h2 class="text-[15px] font-bold tracking-[-.02em] text-slate-800">
						All projects
					</h2>
					<span class="text-[11px] text-slate-500">
						{projects().length} projects
					</span>
				</div>

				<div class="p-4">
					<SearchInput placeholder="Search projects…" label="Search projects" />
				</div>

				<ProjectList projects={projects()} />
			</section>
		</div>
	);
}
