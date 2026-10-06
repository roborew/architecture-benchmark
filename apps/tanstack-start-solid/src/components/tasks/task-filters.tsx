import { useQueryNavigation } from "@/hooks/use-query-navigation";
import { For } from "solid-js";

import type { Project, User } from "@/lib/types";

const selectClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[12px] text-slate-700 outline-none focus:border-brand-500";

export function TaskFilters(props: {
  projects: Project[];
  people: User[];
  search?: string;
  status?: string;
  projectId?: number;
  assigneeId?: number;
}) {
  const search = () => props.search ?? "";
  const status = () => props.status ?? "";
  const projectId = () => props.projectId;
  const assigneeId = () => props.assigneeId;

  const navigateToQuery = useQueryNavigation("/tasks");

  const current = () => ({
    search: search(),
    status: status(),
    projectId: projectId(),
    assigneeId: assigneeId(),
  });

  const apply = (next: Partial<ReturnType<typeof current>>) => {
    const merged = { ...current(), ...next };
    const params = new URLSearchParams();

    if (merged.search) params.set("q", merged.search);
    if (merged.status) params.set("status", merged.status);
    if (merged.projectId !== undefined)
      params.set("project", String(merged.projectId));
    if (merged.assigneeId !== undefined)
      params.set("assignee", String(merged.assigneeId));

    navigateToQuery(params);
  };

  return (
    <form
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        apply({});
      }}
      class="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 lg:flex-row"
    >
      <label class="relative block flex-1">
        <span class="sr-only">Search tasks</span>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute left-3 top-2.5 text-slate-500"
        >
          ⌕
        </span>
        <input
          type="search"
          name="q"
          value={search()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply({ search: (event.currentTarget as HTMLInputElement).value.trim() });
            }
          }}
          placeholder="Search tasks…"
          class="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-[12px] text-slate-700 outline-none placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </label>

      <select
        aria-label="Project"
        name="project"
        value={projectId() === undefined ? "" : String(projectId())}
        onChange={(event) =>
          apply({ projectId: Number(event.currentTarget.value) || undefined })
        }
        class={selectClass}
      >
        <option value="">All projects</option>
        <For each={props.projects}>
          {(project) => (
            <option value={project.id}>{project.name}</option>
          )}
        </For>
      </select>

      <select
        aria-label="Status"
        name="status"
        value={status()}
        onChange={(event) => apply({ status: event.currentTarget.value || undefined })}
        class={selectClass}
      >
        <option value="">All statuses</option>
        <option value="todo">To do</option>
        <option value="in-progress">In progress</option>
        <option value="done">Done</option>
      </select>

      <select
        aria-label="Assignee"
        name="assignee"
        value={assigneeId() === undefined ? "" : String(assigneeId())}
        onChange={(event) =>
          apply({ assigneeId: Number(event.currentTarget.value) || undefined })
        }
        class={selectClass}
      >
        <option value="">All assignees</option>
        <For each={props.people}>
          {(person) => (
            <option value={person.id}>{person.name}</option>
          )}
        </For>
      </select>
    </form>
  );
}
