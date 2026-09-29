import type { Project, User } from "@/types";

const selectClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[12px] outline-none focus:border-brand-500";

export function TaskFilters({
  projects,
  people,
}: {
  projects: Project[];
  people: User[];
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 lg:flex-row">
      <label className="relative block flex-1">
        <span className="sr-only">Search tasks</span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
        >
          ⌕
        </span>
        <input
          type="search"
          placeholder="Search tasks…"
          className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-[12px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </label>

      <select aria-label="Project" className={selectClass} defaultValue="">
        <option value="">All projects</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>

      <select aria-label="Status" className={selectClass} defaultValue="">
        <option value="">All statuses</option>
        <option value="todo">To do</option>
        <option value="in-progress">In progress</option>
        <option value="done">Done</option>
      </select>

      <select aria-label="Assignee" className={selectClass} defaultValue="">
        <option value="">All assignees</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
    </div>
  );
}
