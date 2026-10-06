import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { StatusBadge } from "@/components/status-badge";
import type { TaskWithProject } from "@/lib/types";

const th = "px-3 py-3 first:px-5 last:px-5";
const td = "px-3 py-3.5 first:px-5 last:px-5";

function initials(name: string) {
	return name
		.split(" ")
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
}

export function TaskTable(props: {
	tasks: TaskWithProject[];
	showProject?: boolean;
	showComments?: boolean;
}) {
	const showProject = () => props.showProject ?? false;
	const showComments = () => props.showComments ?? false;

	return (
		<Show
			when={props.tasks.length > 0}
			fallback={
				<p class="px-5 py-6 text-[12px] text-slate-500">
					No tasks match these filters.
				</p>
			}
		>
			<div class="overflow-x-auto">
				<table class="w-full min-w-165 text-left text-[12px]">
					<thead class="border-y border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-[.075em] text-slate-500">
						<tr>
							<th class={th}>Task</th>
							<Show when={showProject()}>
								<th class={th}>Project</th>
							</Show>
							<th class={th}>Status</th>
							<th class={th}>Assignee</th>
							<Show when={showComments()}>
								<th class={th}>Comments</th>
							</Show>
							<th class={th}>Updated</th>
						</tr>
					</thead>
					<tbody class="text-slate-500">
						<For each={props.tasks}>
							{(task) => (
								<tr class="border-b border-slate-100 transition hover:bg-slate-50">
									<td class={td}>
										<Link
											to="/tasks/$id"
											params={{ id: String(task.id) }}
											class="font-bold text-slate-700 hover:text-brand-700"
										>
											{task.title}
										</Link>
										<span class="mt-0.5 block text-[10px] text-slate-500">
											#{task.id}
										</span>
									</td>
									<Show when={showProject()}>
										<td class={td}>{task.projectName}</td>
									</Show>
									<td class={td}>
										<StatusBadge status={task.status} />
									</td>
									<td class={td}>
										<span
											aria-hidden="true"
											class="mr-1.5 inline-grid h-6 w-6 place-items-center rounded-full bg-indigo-50 align-middle text-[9px] font-extrabold text-indigo-600"
										>
											{initials(task.assigneeName)}
										</span>
										{task.assigneeName}
									</td>
									<Show when={showComments()}>
										<td class={td}>{task.commentCount}</td>
									</Show>
									<td class={td}>{task.updatedAt}</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
		</Show>
	);
}
