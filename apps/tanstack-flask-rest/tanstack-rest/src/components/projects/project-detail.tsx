// src/components/projects/project-detail.tsx
//
// One project's board: the header with its summary counts, the status filter
// form, the task table, and the keyset "older" link. The rows arrive as props
// (the route's queries), already sliced to the page, each carrying `cursorFor`
// so the older link needs no second query.

import { Link } from "@tanstack/react-router";

import { TaskTable } from "@/components/tasks/task-table";
import type { Project, ProjectTaskRow } from "@/lib/types";

// The contract's status filter: one tab per status plus `all`. `data-status`
// carries the raw stored spelling (`in progress`, not `in-progress`), so the
// tab keeps the filter in the URL in the spelling the route accepts.
const STATUS_TABS: { value: string; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "todo", label: "To do" },
	{ value: "in progress", label: "In progress" },
	{ value: "done", label: "Done" },
];

function StatCard({
	label,
	value,
	hint,
}: {
	label: string;
	value: number;
	hint: string;
}) {
	return (
		<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-panel sm:p-5">
			<span className="block text-[11px] font-semibold text-slate-500">
				{label}
			</span>
			<strong className="mt-2 block text-[24px] font-extrabold tracking-[-.045em] text-slate-800">
				{value}
			</strong>
			<p className="mt-1 text-[11px] text-slate-500">{hint}</p>
		</div>
	);
}

export function ProjectDetail({
	project,
	tasks,
	status = "",
	hasMore = false,
}: {
	project: Project;
	tasks: ProjectTaskRow[];
	status?: string;
	/** Whether the query filled its page, i.e. whether older rows probably exist. */
	hasMore?: boolean;
}) {
	return (
		<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
				<div>
					<p className="mb-2 text-[11px] font-medium text-slate-500">
						<Link to="/projects" className="hover:text-brand-600">
							Projects
						</Link>{" "}
						/ {project.name}
					</p>
					<h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
						{project.name}
					</h1>
					<p className="mt-1.5 text-[13px] leading-6 text-slate-500">
						{project.description}
					</p>
				</div>
				<div className="flex gap-2">
					<Link
						to="/projects/$id/edit"
						params={{ id: String(project.id) }}
						className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
					>
						Edit project
					</Link>
					<Link
						to="/tasks/new"
						className="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
					>
						＋ New task
					</Link>
				</div>
			</div>

			<section className="mb-5 grid grid-cols-3 gap-3">
				<StatCard
					label="Tasks"
					value={project.taskCount}
					hint="In this project"
				/>
				<StatCard
					label="Open"
					value={project.openTaskCount}
					hint="Not done yet"
				/>
				<StatCard
					label="People"
					value={project.peopleCount}
					hint="Assigned members"
				/>
			</section>

			<section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
				<div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
					<h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
						Project tasks
					</h2>
					{/* The search box is a plain GET form; the status filter is the
					    contract's tab row below, so no client state is needed for
					    either and the applied filter lives in the URL. */}
					<form className="flex gap-2" method="get">
						<label className="relative block">
							<span className="sr-only">Search tasks</span>
							<span
								aria-hidden="true"
								className="pointer-events-none absolute left-3 top-2 text-slate-500"
							>
								⌕
							</span>
							<input
								type="search"
								name="q"
								placeholder="Search tasks…"
								className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-[11px] outline-none focus:border-brand-500 sm:w-48"
							/>
						</label>
						<button type="submit" className="sr-only">
							Apply
						</button>
					</form>
				</div>

				<nav
					aria-label="Status filter"
					className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-5 py-3"
				>
					{STATUS_TABS.map((tab) => {
						const isActive =
							tab.value === "all" ? !status : status === tab.value;

						// A plain `<a>`, not the router's `<Link>`: `<Link>` sets its own
						// `data-status="active|inactive"`, which would clobber the raw
						// value the contract reads from this attribute. A filter can take a
						// full navigation, so the anchor's own href is all that is needed.
						return (
							<a
								key={tab.value}
								href={
									tab.value === "all"
										? `/projects/${project.id}`
										: `/projects/${project.id}?status=${encodeURIComponent(
												tab.value,
											)}`
								}
								data-testid="status-filter"
								data-status={tab.value}
								aria-current={isActive ? "page" : undefined}
								className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition ${
									isActive
										? "border-brand-600 bg-brand-600 text-white"
										: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
								}`}
							>
								{tab.label}
							</a>
						);
					})}
				</nav>

				{/* The project is implied by the page, so the table shows
				    comments but no project column. */}
				{tasks.length === 0 ? (
					<p className="px-5 py-6 text-[12px] text-slate-500">
						No tasks in this project yet.
					</p>
				) : (
					<>
						<TaskTable tasks={tasks} showComments />

						{/* Keyset pagination (spec/queries.md): the cursor carries the
						    `(created_at, id)` of the last row shown, so the next page
						    starts exactly after it. The status is carried too, or the
						    filter would silently reset while the select still shows it. */}
						{hasMore && tasks.length > 0 ? (
							<div className="flex justify-end border-t border-slate-100 px-5 py-4">
								<Link
									to="/projects/$id"
									params={{ id: String(project.id) }}
									search={{
										...(status ? { status } : {}),
										cursor: tasks[tasks.length - 1].cursorFor,
									}}
									data-testid="next-page"
									className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
								>
									Older tasks
								</Link>
							</div>
						) : null}
					</>
				)}
			</section>
		</div>
	);
}
