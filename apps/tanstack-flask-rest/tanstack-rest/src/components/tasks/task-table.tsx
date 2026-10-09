// src/components/tasks/task-table.tsx
//
// The shared task table: one row per task, linking to its detail page. The
// project and comments columns are optional because the three surfaces that
// reuse it need different subsets — the workspace list shows both, a project
// board shows comments only (the project is implied by the page), and a
// member's page shows the project only.

import { Link } from "@tanstack/react-router";

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

export function TaskTable({
	tasks,
	showProject = false,
	showComments = false,
}: {
	tasks: TaskWithProject[];
	showProject?: boolean;
	showComments?: boolean;
}) {
	if (tasks.length === 0) {
		return (
			<p className="px-5 py-6 text-[12px] text-slate-500">
				No tasks match these filters.
			</p>
		);
	}

	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-165 text-left text-[12px]">
				<thead className="border-y border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-[.075em] text-slate-500">
					<tr>
						<th className={th}>Task</th>
						{showProject && <th className={th}>Project</th>}
						<th className={th}>Status</th>
						<th className={th}>Assignee</th>
						{showComments && <th className={th}>Comments</th>}
						<th className={th}>Updated</th>
					</tr>
				</thead>
				<tbody className="text-slate-500">
					{tasks.map((task) => (
						<tr
							key={task.id}
							data-testid="task-row"
							className="border-b border-slate-100 transition hover:bg-slate-50"
						>
							<td className={td}>
								<Link
									to="/tasks/$id"
									params={{ id: String(task.id) }}
									data-testid="task-title"
									className="font-bold text-slate-700 hover:text-brand-700"
								>
									{task.title}
								</Link>
								<span className="mt-0.5 block text-[10px] text-slate-500">
									#{task.id}
								</span>
							</td>
							{showProject && <td className={td}>{task.projectName}</td>}
							<td className={td} data-testid="task-status">
								<StatusBadge status={task.status} />
							</td>
							<td className={td}>
								<span
									aria-hidden="true"
									className="mr-1.5 inline-grid h-6 w-6 place-items-center rounded-full bg-indigo-50 align-middle text-[9px] font-extrabold text-indigo-600"
								>
									{initials(task.assigneeName)}
								</span>
								{/* The name alone carries `task-assignee`: the avatar initials
								    are decorative, so the testid's text is exactly the display
								    name (or `Unassigned`). */}
								<span data-testid="task-assignee">{task.assigneeName}</span>
							</td>
							{showComments && <td className={td}>{task.commentCount}</td>}
							<td className={td}>{task.updatedAt}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
