// src/components/tasks/tasks-page.tsx
//
// The workspace-wide task list page: the filter bar, the table, and the
// keyset pagination controls, over a summary line built from the count
// aggregate.
//
// Presentational — the whole page bag arrives as one prop from the route,
// which owns the four queries (rows, count, projects, people) and the derived
// paging state. The shape mirrors the reference variant's loader result so
// the markup ports one-for-one: only who computes it differs.

import { Link } from "@tanstack/react-router";

import type { PageRange } from "@/lib/pagination";
import { formatRange } from "@/lib/pagination";
import type { Project, TaskRow, User } from "@/lib/types";
import { TaskFilters } from "./task-filters";
import { TaskPagination } from "./task-pagination";
import { TaskTable } from "./task-table";

/** The filters the filter bar shows as applied — the URL's own spelling. */
export type TasksPageFilters = {
	search: string;
	/** Query-string spelling: "in-progress" rather than "in progress". */
	status: string;
	projectId?: number;
	assigneeId?: number;
};

/**
 * Everything the page renders, as computed by the route: the sliced rows, the
 * filter selects' option lists, the paging state, and the summary range.
 */
export type TasksPageData = {
	/** This page's rows, already sliced to the page size. */
	rows: TaskRow[];
	/** Every project, for the filter select. */
	projects: Project[];
	/** Every member, for the filter select. */
	people: User[];
	/** The applied page size. */
	size: number;
	/** Whether any filter is applied, for the summary line's suffix. */
	filtered: boolean;
	/** Whether older rows probably exist (the query over-fetched by one). */
	hasMore: boolean;
	/** Whether this is a later page of the current filter set. */
	onLaterPage: boolean;
	/** Search params for "Previous": the current filters, cursor dropped. */
	firstSearch: Record<string, string>;
	/** Search params for "Next": the current filters plus the new cursor. */
	nextSearch: Record<string, string>;
	/** The absolute positions this page occupies within the total. */
	range: PageRange;
	/** The filters the bar shows as applied. */
	filters: TasksPageFilters;
};

export function TasksPage({ data }: { data: TasksPageData }) {
	return (
		<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
				<div>
					<p className="mb-2 text-[11px] font-medium text-slate-500">
						Workspace / All tasks
					</p>
					<h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
						All tasks
					</h1>
					<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
						A workspace-wide view of tasks across every project.
					</p>
				</div>
				<Link
					to="/tasks/new"
					className="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
				>
					＋ New task
				</Link>
			</div>

			<section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
				<TaskFilters
					projects={data.projects}
					people={data.people}
					search={data.filters.search}
					status={data.filters.status}
					projectId={data.filters.projectId}
					assigneeId={data.filters.assigneeId}
				/>

				<TaskTable tasks={data.rows} showProject showComments />

				<div className="flex items-center justify-between px-5 py-4 text-[11px] text-slate-500">
					<span>{formatRange({ ...data.range, filtered: data.filtered })}</span>
					{/* Keyset pagination (spec/queries.md). */}
					<TaskPagination
						hasNewer={data.onLaterPage}
						hasOlder={data.hasMore}
						firstSearch={data.firstSearch}
						nextSearch={data.nextSearch}
						size={data.size}
					/>
				</div>
			</section>
		</div>
	);
}
