// src/components/recent-tasks.tsx
//
// The dashboard's recent-activity table: the newest updated tasks across every
// project, each linking to its detail page. The rows arrive as a prop (the
// dashboard route's query), already bounded by the aggregate — this component
// renders what it is given and adds nothing.

import { Link } from "@tanstack/react-router";

import type { DashboardTask } from "@/lib/types";
import { StatusBadge } from "./status-badge";

const th = "px-3 py-3 first:px-5 last:px-5";
const td = "px-3 py-3.5 first:px-5 last:px-5";

export function RecentTasks({ tasks }: { tasks: DashboardTask[] }) {
	return (
		<section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
			<div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
				<div>
					<h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
						Recent tasks
					</h2>
					<p className="mt-0.5 text-[11px] text-slate-500">
						Latest task activity across every project
					</p>
				</div>
				<Link
					to="/tasks"
					className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
				>
					View all tasks
				</Link>
			</div>

			{tasks.length === 0 ? (
				<p className="px-5 py-6 text-[12px] text-slate-500">
					No recent task activity.
				</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full min-w-165 text-left text-[12px]">
						<thead className="border-y border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-[.075em] text-slate-500">
							<tr>
								<th className={th}>Task</th>
								<th className={th}>Status</th>
								<th className={th}>Assignee</th>
								<th className={th}>Updated</th>
							</tr>
						</thead>
						<tbody className="text-slate-500">
							{tasks.map((task) => (
								<tr
									key={task.id}
									className="border-b border-slate-100 transition hover:bg-slate-50"
								>
									<td className={td}>
										<Link
											to="/tasks/$id"
											params={{ id: String(task.id) }}
											className="font-bold text-slate-700 hover:text-brand-700"
										>
											{task.title}
										</Link>
										<span className="mt-0.5 block text-[10px] text-slate-500">
											{task.projectName}
										</span>
									</td>
									<td className={td}>
										<StatusBadge status={task.status} />
									</td>
									<td className={td}>{task.assigneeName}</td>
									<td className={td}>{task.updatedAt}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
