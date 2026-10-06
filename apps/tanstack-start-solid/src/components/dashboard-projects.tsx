import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";

import type { DashboardProject } from "@/lib/types";

export function DashboardProjects(props: { projects: DashboardProject[] }) {
	return (
		<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
			<div class="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
				<div>
					<h2 class="text-[15px] font-bold tracking-[-.02em] text-slate-800">
						Projects
					</h2>
					<p class="mt-1 text-[11px] text-slate-500">
						Open a project to view and manage its tasks
					</p>
				</div>
				<Link
					to="/projects"
					class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
				>
					View projects
				</Link>
			</div>

			<ul class="grid gap-3 p-5 sm:grid-cols-2">
				<For each={props.projects}>
					{(project) => (
						<li>
							<Link
								to="/projects/$id"
								params={{ id: String(project.id) }}
								class="block rounded-xl border border-slate-200 bg-white p-4 text-left shadow-panel transition hover:border-brand-200 hover:bg-brand-50"
							>
								<div class="flex items-start justify-between gap-3">
									<div>
										<h3 class="font-bold text-slate-700">{project.name}</h3>
										<p class="mt-1 text-[11px] leading-5 text-slate-500">
											{project.description}
										</p>
									</div>
									<span class="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
										{project.taskCount}
									</span>
								</div>
								<div class="mt-4 flex gap-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
									<b class="text-slate-700">{project.openTaskCount}</b> open
									<b class="text-slate-700">{project.peopleCount}</b> people
								</div>
							</Link>
						</li>
					)}
				</For>
			</ul>
		</section>
	);
}
