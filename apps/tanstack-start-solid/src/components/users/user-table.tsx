import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { initials } from "@/lib/initials";
import type { User } from "@/lib/types";

const th = "px-3 py-3 first:px-5 last:px-5";
const td = "px-3 py-3.5 first:px-5 last:px-5";

export function UserTable(props: { people: User[] }) {
	return (
		<Show
			when={props.people.length > 0}
			fallback={
				<p class="px-5 py-6 text-[12px] text-slate-500">
					No people in this workspace.
				</p>
			}
		>
			<div class="overflow-x-auto">
				<table class="w-full min-w-165 text-left text-[12px]">
					<thead class="border-y border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-[.075em] text-slate-500">
						<tr>
							<th class={th}>Person</th>
							<th class={th}>Assigned tasks</th>
							<th class={th}>Open tasks</th>
							<th class={th}>Comments</th>
						</tr>
					</thead>
					<tbody class="text-slate-500">
						<For each={props.people}>
							{(person) => (
								<tr class="border-b border-slate-100 transition hover:bg-slate-50">
									<td class={td}>
										<Link
											to="/users/$id"
											params={{ id: String(person.id) }}
											class="flex items-center gap-2 text-left"
										>
											<span
												aria-hidden="true"
												class="mr-2 inline-grid h-8 w-8 place-items-center rounded-full bg-indigo-50 align-middle text-[10px] font-extrabold text-indigo-600"
											>
												{initials(person.name)}
											</span>
											<span>
												<b class="block text-slate-700">{person.name}</b>
												<small class="block text-[11px] text-slate-500">
													{person.email}
												</small>
											</span>
										</Link>
									</td>
									<td class={td}>{person.assignedTaskCount}</td>
									<td class={td}>{person.openTaskCount}</td>
									<td class={td}>{person.commentCount}</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
		</Show>
	);
}
