import { useQueryNavigation } from "@/hooks/use-query-navigation";

import type { Project, User } from "@/lib/types";

const selectClass =
	"rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[12px] text-slate-700 outline-none focus:border-brand-500";

/**
 * The workspace list's filter bar.
 *
 * The applied filters live in the URL, so a filtered list is shareable, survives
 * a reload, and the server does the filtering.
 *
 * It submits through the router rather than letting the GET form navigate
 * natively, for two reasons: a native GET submit emits every empty control as a
 * bare `?q=&status=&assignee=`, and it can land after a second, faster
 * navigation and overwrite it. Building the query here keeps the URL to the
 * filters that are actually set.
 *
 * Each select is keyed on its current value. Without the key, React keeps the
 * pre-change value after a navigation, so the next change would be built from
 * the filter the user just navigated away from.
 */
export function TaskFilters({
	projects,
	people,
	search = "",
	status = "",
	projectId,
	assigneeId,
}: {
	projects: Project[];
	people: User[];
	search?: string;
	/** Query-string spelling: "in-progress" rather than "in progress". */
	status?: string;
	projectId?: number;
	assigneeId?: number;
}) {
	const navigateToQuery = useQueryNavigation("/tasks");

	// The currently applied values, used to rebuild the URL on the next change.
	const current = { search, status, projectId, assigneeId };

	const apply = (next: Partial<typeof current>) => {
		const merged = { ...current, ...next };
		const params = new URLSearchParams();

		if (merged.search) params.set("q", merged.search);
		if (merged.status) params.set("status", merged.status);
		if (merged.projectId !== undefined)
			params.set("project", String(merged.projectId));
		if (merged.assigneeId !== undefined)
			params.set("assignee", String(merged.assigneeId));

		// Changing a filter invalidates the cursor and the page number, so both
		// are dropped rather than carried into a result set they no longer match.
		navigateToQuery(params);
	};

	return (
		<form
			method="get"
			onSubmit={(event) => {
				event.preventDefault();
				apply({});
			}}
			className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 lg:flex-row"
		>
			<label className="relative block flex-1">
				<span className="sr-only">Search tasks</span>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute left-3 top-2.5 text-slate-500"
				>
					⌕
				</span>
				<input
					type="search"
					name="q"
					defaultValue={search}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							apply({ search: event.currentTarget.value.trim() });
						}
					}}
					placeholder="Search tasks…"
					className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-[12px] text-slate-700 outline-none placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
				/>
			</label>

			<select
				key={`project-${projectId ?? ""}`}
				aria-label="Project"
				name="project"
				defaultValue={projectId === undefined ? "" : String(projectId)}
				onChange={(event) =>
					apply({ projectId: Number(event.target.value) || undefined })
				}
				className={selectClass}
			>
				<option value="">All projects</option>
				{projects.map((project) => (
					<option key={project.id} value={project.id}>
						{project.name}
					</option>
				))}
			</select>

			<select
				key={`status-${status}`}
				aria-label="Status"
				name="status"
				defaultValue={status}
				onChange={(event) => apply({ status: event.target.value || undefined })}
				className={selectClass}
			>
				<option value="">All statuses</option>
				<option value="todo">To do</option>
				<option value="in-progress">In progress</option>
				<option value="done">Done</option>
			</select>

			<select
				key={`assignee-${assigneeId ?? ""}`}
				aria-label="Assignee"
				name="assignee"
				defaultValue={assigneeId === undefined ? "" : String(assigneeId)}
				onChange={(event) =>
					apply({ assigneeId: Number(event.target.value) || undefined })
				}
				className={selectClass}
			>
				<option value="">All assignees</option>
				{people.map((person) => (
					<option key={person.id} value={person.id}>
						{person.name}
					</option>
				))}
			</select>
		</form>
	);
}
