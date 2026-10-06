import { Link } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { TaskTable } from "@/components/tasks/task-table";
import { DeleteUserButton } from "@/components/users/delete-user-button";
import type { TaskWithProject, User } from "@/lib/types";

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

export function UserDetail(props: { person: User; tasks: TaskWithProject[] }) {
	return (
		<div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
				<div>
					<p class="mb-2 text-[11px] font-medium text-slate-500">
						<Link to="/users" class="hover:text-brand-600">
							People
						</Link>{" "}
						/ {props.person.name}
					</p>
					<h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
						{props.person.name}
					</h1>
					<p class="mt-1.5 text-[13px] leading-6 text-slate-500">
						{props.person.email}
					</p>
				</div>
				<div class="flex items-center gap-3">
					<Link
						to="/users/$id/edit"
						params={{ id: String(props.person.id) }}
						class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
					>
						Edit user
					</Link>
					<DeleteUserButton person={props.person} />
				</div>
			</div>

			<section class="mb-5 grid grid-cols-2 gap-3">
				<StatCard
					label="Assigned tasks"
					value={props.person.assignedTaskCount}
					hint="Across projects"
				/>
				<StatCard
					label="Comments authored"
					value={props.person.commentCount}
					hint="On assigned tasks"
				/>
			</section>

			<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
				<div class="border-b border-slate-100 px-5 py-4">
					<h2 class="text-[15px] font-bold tracking-[-.02em] text-slate-800">
						Assigned tasks
					</h2>
				</div>
				<Show
					when={props.tasks.length > 0}
					fallback={
						<p class="px-5 py-6 text-[12px] text-slate-500">
							No tasks are assigned to this person.
						</p>
					}
				>
					<TaskTable tasks={props.tasks} showProject />
				</Show>
			</section>
		</div>
	);
}
