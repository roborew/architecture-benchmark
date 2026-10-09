// src/routes/projects.$id.index.tsx — one project and its task board.
//
// The data flow is the TanStack Query + Router pattern: the loader warms the
// project's own row and its board page (`ensureQueryData`) before the route
// renders, and the component reads the same queries with `useQuery` — the
// identical options objects (src/queries/projects-query.ts) are what make the two
// agree on the cache entries.
//
// The not-found outcome is a rendered state rather than `notFound()`, because
// that is what the reference variant does: the loader returns null for an id
// that matches no row (or is not a number at all) and the component renders
// the inline block with a way back to the list. An unreachable API is NOT
// that state — it renders the route's errorComponent instead.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ApiError } from "@/api/api";
import { ProjectDetail } from "@/components/projects/project-detail";
import {
	ProjectsError,
	ProjectsRouteError,
} from "@/components/projects/projects-error";
import {
	projectQueryOptions,
	projectTasksQueryOptions,
} from "@/queries/projects-query";

/**
 * The status filter's query-string spelling.
 *
 * A raw space is awkward in a query string while the stored value is "in
 * progress" (spec/contract.md), so the two are translated here and the query
 * layer only ever sees the stored form.
 */
const STATUS_FROM_QUERY: Record<string, string> = {
	todo: "todo",
	"in-progress": "in progress",
	// The tabs' GET links write the raw stored spelling into the query string, so
	// `?status=in progress` must resolve to the same filter as the legacy
	// `in-progress`.
	"in progress": "in progress",
	done: "done",
};

/**
 * Over-fetch by one row to learn whether more exist: the extra row is dropped
 * before rendering, so the page still shows at most `PAGE` tasks.
 */
const PAGE = 25;

/** The board page's filters, derived once so the loader and the component agree. */
function boardFilters({
	status,
	cursor,
}: {
	status?: string;
	cursor?: string;
}) {
	const statusParam = status ?? "";
	const appliedStatus =
		statusParam && statusParam in STATUS_FROM_QUERY
			? STATUS_FROM_QUERY[statusParam]
			: undefined;

	return {
		status: appliedStatus,
		cursor: (cursor ?? "") || undefined,
		limit: PAGE + 1,
	};
}

export const Route = createFileRoute("/projects/$id/")({
	// Typed as optional so a `<Link to="/projects/$id">` elsewhere does not have
	// to pass a `search` object; the validator still returns plain strings.
	// Absent params resolve to `undefined`, not "". A validator that returns an
	// empty string makes TanStack write it into the URL, so navigating to a
	// project would land on /projects/1?status=&cursor= instead of /projects/1
	// — an observable difference from the reference app and one the e2e suite
	// asserts on. Undefined params are omitted from the search string entirely.
	//
	// Numeric values are coerced as well: TanStack's default search parsing is
	// JSON-based, so a hand-edited ?status=2 would otherwise be dropped rather
	// than rejected by the status check in `boardFilters`.
	validateSearch: (
		search: Record<string, unknown>,
	): {
		status?: string;
		cursor?: string;
	} => ({
		status:
			typeof search.status === "string"
				? search.status
				: typeof search.status === "number" && Number.isFinite(search.status)
					? String(search.status)
					: undefined,
		cursor:
			typeof search.cursor === "string"
				? search.cursor
				: typeof search.cursor === "number" && Number.isFinite(search.cursor)
					? String(search.cursor)
					: undefined,
	}),
	loaderDeps: ({ search }) => ({ ...search }),
	loader: async ({ params, deps, context }) => {
		// `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
		// row, so both paths land on the not-found state in the component.
		const projectId = Number(params.id);

		if (!Number.isInteger(projectId)) return null;

		try {
			await context.queryClient.ensureQueryData(projectQueryOptions(projectId));
		} catch (error) {
			// The API answers 404 for a missing row; that is the not-found state
			// the component renders, not an error page. Anything else (the API
			// unreachable, a 5xx) is a real error and propagates to the
			// errorComponent.
			if (error instanceof ApiError && error.status === 404) return null;
			throw error;
		}

		await context.queryClient.ensureQueryData(
			projectTasksQueryOptions(projectId, boardFilters(deps)),
		);
	},
	// A failed fetch renders HERE, inside the shell, rather than tearing the
	// route tree down to a blank screen (the router's CatchBoundary fallback).
	errorComponent: ProjectsRouteError,
	component: ProjectBoardRoute,
});

/** The board's inline not-found state, mirroring the reference variant's. */
function ProjectNotFound() {
	return (
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
	);
}

function ProjectBoardRoute() {
	const { id } = Route.useParams();
	const search = Route.useSearch();

	// `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
	// row, so both paths land on the not-found state below.
	const projectId = Number(id);
	const isValid = Number.isInteger(projectId);

	// The queries are declared unconditionally (hooks cannot be called
	// conditionally); an invalid id leaves them disabled, so nothing is fetched
	// for a URL the board cannot answer.
	const projectQuery = useQuery({
		...projectQueryOptions(projectId),
		enabled: isValid,
	});
	const tasksQuery = useQuery({
		...projectTasksQueryOptions(projectId, boardFilters(search)),
		enabled: isValid,
	});

	if (!isValid) {
		return <ProjectNotFound />;
	}

	if (projectQuery.isPending || tasksQuery.isPending) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">Loading project…</p>
			</div>
		);
	}

	if (projectQuery.isError) {
		// A 404 from the API is the same not-found state the loader mapped to
		// null: the component guards a refetch that fails after a successful
		// render (the project was deleted in another tab).
		if (
			projectQuery.error instanceof ApiError &&
			projectQuery.error.status === 404
		) {
			return <ProjectNotFound />;
		}

		return <ProjectsError error={projectQuery.error} />;
	}

	if (tasksQuery.isError) {
		return <ProjectsError error={tasksQuery.error} />;
	}

	const project = projectQuery.data;
	const fetched = tasksQuery.data;

	// Over-fetched by one so `hasMore` costs no second query; the extra row is
	// dropped before rendering.
	const hasMore = fetched.length > PAGE;
	const tasks = fetched.slice(0, PAGE);

	return (
		<ProjectDetail
			project={project}
			tasks={tasks}
			// The canonical stored value (not the raw query spelling), so the tabs
			// light the same one for `?status=in progress` and the legacy
			// `in-progress` and the older link carries the stored form.
			status={boardFilters(search).status ?? ""}
			hasMore={hasMore}
		/>
	);
}
