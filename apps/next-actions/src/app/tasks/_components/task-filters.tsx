"use client";

import { useRef } from "react";

import type { Project, User } from "@/lib/types";

const selectClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[12px] text-slate-700 outline-none focus:border-brand-500";

/**
 * The workspace list's filter bar.
 *
 * A plain GET form rather than controlled client state: the applied filters
 * live in the URL, so a filtered list is shareable, survives a reload, and the
 * server does the filtering.
 *
 * Each select is keyed on its current value. Without the key, React keeps the
 * pre-change value after a navigation, so the submission would carry the filter
 * the user just navigated away from.
 *
 * Changing a select submits the form immediately, and Enter in the search box
 * does the same — there is no separate Apply button, so there is no state in
 * which the visible filters and the submitted ones disagree.
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
  const form = useRef<HTMLFormElement>(null);

  const submit = () => form.current?.requestSubmit();

  return (
    <form
      ref={form}
      method="get"
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
              submit();
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
        onChange={submit}
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
        onChange={submit}
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
        onChange={submit}
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
