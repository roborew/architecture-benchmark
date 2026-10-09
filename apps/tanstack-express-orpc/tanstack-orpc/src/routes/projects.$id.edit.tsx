// src/routes/projects.$id.edit.tsx — the edit-project form.
//
// The data flow is the TanStack Query + Router pattern: the loader warms the
// project's own row (`ensureQueryData`) before the route renders, and the
// component reads the same query with `useQuery` — the identical options
// object (src/queries/projects-query.ts) is what makes the two agree on the cache
// entry.
//
// A missing project is `notFound()`, thrown by the loader, with the same
// markup registered as the route's `notFoundComponent` — mirroring the
// reference variant exactly: an inline-looking block with the contract's
// `not-found` testid. An unreachable API is NOT not-found: it renders the
// errorComponent instead.

import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ProjectForm } from "@/components/projects/project-form";
import {
	ProjectsError,
	ProjectsRouteError,
} from "@/components/projects/projects-error";
import { projectQueryOptions } from "@/queries/projects-query";

export const Route = createFileRoute("/projects/$id/edit")({
	loader: async ({ params, context }) => {
		// `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
		// row, so both paths land on the not-found page.
		const projectId = Number(params.id);

		if (!Number.isInteger(projectId)) {
			throw notFound();
		}

		try {
			await context.queryClient.ensureQueryData(projectQueryOptions(projectId));
		} catch (error) {
			// The API answers NOT_FOUND for a missing row: the same not-found page the
			// NaN id produced. Anything else (the API unreachable, a 5xx) is a
			// real error and propagates to the errorComponent.
			if (error instanceof ORPCError && error.code === "NOT_FOUND")
				throw notFound();
			throw error;
		}
	},
	notFoundComponent: ProjectNotFound,
	// A failed fetch renders HERE, inside the shell, rather than tearing the
	// route tree down to a blank screen (the router's CatchBoundary fallback).
	errorComponent: ProjectsRouteError,
	component: EditProjectPage,
});

function EditProjectPage() {
	const { id } = Route.useParams();

	const { isPending, isError, error, data } = useQuery(
		projectQueryOptions(Number(id)),
	);

	if (isPending) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">Loading project…</p>
			</div>
		);
	}

	if (isError) {
		// The loader already mapped the first NOT_FOUND to the not-found page; this
		// guards a refetch that fails after a successful render.
		if (error instanceof ORPCError && error.code === "NOT_FOUND") {
			return <ProjectNotFound />;
		}

		return <ProjectsError error={error} />;
	}

	return <ProjectForm project={data} />;
}

function ProjectNotFound() {
	return (
		<div data-testid="not-found">
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
					Project not found
				</h1>
				<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
					No project matches that id.
				</p>
				<Link
					to="/projects"
					className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
				>
					Back to Projects
				</Link>
			</div>
		</div>
	);
}
