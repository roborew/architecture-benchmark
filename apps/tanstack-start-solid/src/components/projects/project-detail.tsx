import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { TaskTable } from "@/components/tasks/task-table";
import type { Project, ProjectTaskRow } from "@/lib/types";

function StatCard(props: { label: string; value: number; hint: string }) {
	return (
		<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-panel sm:p-5">
			<span class="block text-[11px] font-semibold text-slate-500">
				{props.label}
			</span>
			<strong class="mt-2 block text-[24px] font-extrabold tracking-[-.045em] text-slate-800">
				{props.value}
			</strong>
			<p class="mt-1 text-[11px] text-slate-500">{props.hint}</p>
		</div>
	);
}

export function ProjectDetail(props: {
	project: Project;
	tasks: ProjectTaskRow[];
	status?: string;
	hasMore?: boolean;
}) {
	const status = () => props.status ?? "";
	const hasMore = () => props.hasMore ?? false;

	return (
		<div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
				<div>
					<p class="mb-2 text-[11px] font-medium text-slate-500">
						<Link to="/projects" class="hover:text-brand-600">
							Projects
						</Link>{" "}
						/ {props.project.name}
					</p>
					<h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
						{props.project.name}
					</h1>
					<p class="mt-1.5 text-[13px] leading-6 text-slate-500">
						{props.project.description}
					</p>
				</div>
				<div class="flex gap-2">
					<Link
						to="/projects/$id/edit"
						params={{ id: String(props.project.id) }}
						class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
					>
						Edit project
					</Link>
					<Link
						to="/tasks/new"
						class="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
					>
						＋ New task
					</Link>
				</div>
			</div>

			<section class="mb-5 grid grid-cols-3 gap-3">
				<StatCard
					label="Tasks"
					value={props.project.taskCount}
					hint="In this project"
				/>
				<StatCard
					label="Open"
					value={props.project.openTaskCount}
					hint="Not done yet"
				/>
				<StatCard
					label="People"
					value={props.project.peopleCount}
					hint="Assigned members"
				/>
			</section>

			<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
				<div class="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
					<h2 class="text-[15px] font-bold tracking-[-.02em] text-slate-800">
						Project tasks
					</h2>
					<form class="flex gap-2" method="get">
						<label class="relative block">
							<span class="sr-only">Search tasks</span>
							<span
								aria-hidden="true"
								class="pointer-events-none absolute left-3 top-2 text-slate-500"
							>
								⌕
							</span>
							<input
								type="search"
								name="q"
								placeholder="Search tasks…"
								class="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-[11px] outline-none focus:border-brand-500 sm:w-48"
							/>
						</label>
						<select
							aria-label="Status"
							name="status"
							value={status()}
							class="rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px] text-slate-700 outline-none focus:border-brand-500"
						>
							<option value="">All statuses</option>
							<option value="todo">To do</option>
							<option value="in-progress">In progress</option>
							<option value="done">Done</option>
						</select>
						<button type="submit" class="sr-only">
							Apply
						</button>
					</form>
				</div>

				<Show
					when={props.tasks.length > 0}
					fallback={
						<p class="px-5 py-6 text-[12px] text-slate-500">
							No tasks in this project yet.
						</p>
					}
				>
					<TaskTable tasks={props.tasks} showComments />

					<Show when={hasMore() && props.tasks.length > 0}>
						<div class="flex justify-end border-t border-slate-100 px-5 py-4">
							<Link
								to="/projects/$id"
								params={{ id: String(props.project.id) }}
								search={{
									...(status() ? { status: status() } : {}),
									cursor: props.tasks[props.tasks.length - 1].cursorFor,
								}}
								data-testid="next-page"
								class="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
							>
								Older tasks
							</Link>
						</div>
					</Show>
				</Show>
			</section>
		</div>
	);
}
