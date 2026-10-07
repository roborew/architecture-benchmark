// src/routes/tasks.index.tsx — the workspace-wide task list.
//
// The data flow is the TanStack Query + Router pattern: the loader warms the
// query cache (`ensureQueryData`) before the route renders, and the component
// reads the same queries with `useQuery` — the identical options objects
// (src/queries/*-query.ts) are what make the two agree on the cache entries.
//
// The loader runs once per navigation; `useQuery` re-runs when the search
// params change, so picking a filter or a page size refreshes the table
// without a manual reload. The filters/paging arithmetic lives in
// `resolveListState` so the loader and the component derive the exact same
// filter objects — the shared keys are the whole contract.
//
// What the reference variant computed in its loader (the over-fetch by one,
// the sliced rows, the carried cursors) is computed here in the component
// from the query results, because that is the only place that re-runs on a
// search change; the shape it hands the page is the reference's own.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { TasksError, TasksRouteError } from "@/components/tasks/tasks-error";
import { TasksPage } from "@/components/tasks/tasks-page";
import {
	DEFAULT_PAGE_SIZE,
	pageRange,
	parsePage,
	parsePageSize,
} from "@/lib/pagination";
import { parseTasksSearch, type TasksSearch } from "@/lib/tasks-search";
import { projectsQueryOptions } from "@/queries/projects-query";
import {
	taskCountQueryOptions,
	tasksQueryOptions,
} from "@/queries/tasks-query";
import { usersQueryOptions } from "@/queries/users-query";

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
	done: "done",
};

/** A select value is a positive integer id, or nothing when unset. */
function toOptionalId(value: string) {
	if (!value) return undefined;

	const id = Number(value);

	return Number.isInteger(id) && id > 0 ? id : undefined;
}

/**
 * Resolves the route's search params into the filter objects the queries take.
 *
 * Everything downstream — the loader's prefetch, the component's reads, the
 * summary line's arithmetic — is derived from this one pass, so the two
 * cannot disagree about how a URL spells a filter.
 */
function resolveListState(deps: TasksSearch) {
	const search = deps.q ?? "";
	const statusParam = deps.status ?? "";
	const projectId = toOptionalId(deps.project ?? "");
	const assigneeId = toOptionalId(deps.assignee ?? "");
	const rawCursor = deps.cursor ?? "";
	const cursor = rawCursor === "" ? null : rawCursor;
	const onLaterPage = cursor !== null;

	// The page size is a query LIMIT, so only the offered values are accepted.
	const size = parsePageSize(deps.size);

	// The cursor does the paging; the page number is display state alongside it,
	// because a keyset walk carries no offset to derive a position from.
	const page = parsePage(deps.page, { hasCursor: onLaterPage });

	const status =
		statusParam in STATUS_FROM_QUERY ? STATUS_FROM_QUERY[statusParam] : "";

	// The count takes the filters without the paging; the list over-fetches by
	// one row so `hasMore` costs no COUNT beyond the one already backing the
	// summary line (spec/queries.md).
	const countFilters = { q: search, status, projectId, assigneeId };
	const listFilters = { ...countFilters, limit: size + 1, cursor };

	return {
		search,
		statusParam,
		projectId,
		assigneeId,
		cursor,
		onLaterPage,
		size,
		page,
		countFilters,
		listFilters,
	};
}

export const Route = createFileRoute("/tasks/")({
	validateSearch: parseTasksSearch,
	// Re-run the loader when the query changes, so the loader's prefetch
	// follows the filters and the paging.
	loaderDeps: ({ search }) => ({ ...search }),
	loader: async ({ deps, context }) => {
		const state = resolveListState(deps);

		// Four independent reads, warmed concurrently — the rows, the count
		// behind the summary line, and the two option lists for the filter bar.
		await Promise.all([
			context.queryClient.ensureQueryData(tasksQueryOptions(state.listFilters)),
			context.queryClient.ensureQueryData(
				taskCountQueryOptions(state.countFilters),
			),
			context.queryClient.ensureQueryData(projectsQueryOptions()),
			context.queryClient.ensureQueryData(usersQueryOptions()),
		]);
	},
	// A failed fetch renders HERE, inside the shell, rather than tearing the
	// route tree down to a blank screen (the router's CatchBoundary fallback).
	errorComponent: TasksRouteError,
	component: TasksRoute,
});

function TasksRoute() {
	const search = Route.useSearch();
	const state = resolveListState(search);

	const tasksQuery = useQuery(tasksQueryOptions(state.listFilters));
	const countQuery = useQuery(taskCountQueryOptions(state.countFilters));
	const projectsQuery = useQuery(projectsQueryOptions());
	const peopleQuery = useQuery(usersQueryOptions());

	if (
		tasksQuery.isPending ||
		countQuery.isPending ||
		projectsQuery.isPending ||
		peopleQuery.isPending
	) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">Loading tasks…</p>
			</div>
		);
	}

	// The loader already handled the first failure via errorComponent; these
	// guards cover a refetch that fails after a successful render. Each is
	// checked per query so the survivors' data narrows to what was fetched.
	if (tasksQuery.isError) {
		return <TasksError error={tasksQuery.error} />;
	}

	if (countQuery.isError) {
		return <TasksError error={countQuery.error} />;
	}

	if (projectsQuery.isError) {
		return <TasksError error={projectsQuery.error} />;
	}

	if (peopleQuery.isError) {
		return <TasksError error={peopleQuery.error} />;
	}

	const tasks = tasksQuery.data;
	const total = countQuery.data;

	// Over-fetched by one so `hasMore` costs no COUNT beyond the one already
	// backing the summary line.
	const hasMore = tasks.length > state.size;
	const rows = tasks.slice(0, state.size);
	const lastCursor = rows.at(-1)?.cursorFor;

	// Keyset paging only moves forward from a cursor, so "Previous" re-runs the
	// first page rather than walking backwards through cursors it no longer has.
	//
	// These are built as structured search objects rather than pre-joined href
	// strings, so TanStack owns the encoding exactly once (the navigation
	// helpers take URLSearchParams built from these).
	const carried: Record<string, string> = {
		...(state.search ? { q: state.search } : {}),
		...(state.statusParam ? { status: state.statusParam } : {}),
		...(state.projectId === undefined
			? {}
			: { project: String(state.projectId) }),
		...(state.assigneeId === undefined
			? {}
			: { assignee: String(state.assigneeId) }),
		...(state.size === DEFAULT_PAGE_SIZE ? {} : { size: String(state.size) }),
	};

	// "Next" carries the cursor of the last row on this page plus the display
	// page number; "Previous" drops the cursor, returning to page 1 of the
	// same filters.
	const nextSearch = lastCursor
		? { ...carried, page: String(state.page + 1), cursor: lastCursor }
		: carried;

	const filtered =
		Boolean(state.search) ||
		Boolean(state.statusParam) ||
		state.projectId !== undefined ||
		state.assigneeId !== undefined;

	return (
		<TasksPage
			data={{
				rows,
				projects: projectsQuery.data,
				people: peopleQuery.data,
				size: state.size,
				filtered,
				hasMore,
				onLaterPage: state.onLaterPage,
				// The cursor is opaque and already base64url, so it needs no encoding
				// here — it is passed through to the router as-is.
				firstSearch: carried,
				nextSearch,
				range: pageRange({ page: state.page, size: state.size, total }),
				filters: {
					search: state.search,
					status: state.statusParam,
					projectId: state.projectId,
					assigneeId: state.assigneeId,
				},
			}}
		/>
	);
}
