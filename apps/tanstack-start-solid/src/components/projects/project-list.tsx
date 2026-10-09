import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { formatDate } from "@/lib/format";
import type { Project } from "@/lib/types";
import { DeleteProjectButton } from "./delete-project-button";

const th = "px-3 py-3 first:px-5 last:px-5";
const td = "px-3 py-3.5 first:px-5 last:px-5";

export function ProjectList(props: { projects: Project[] }) {
  return (
    <Show
      when={props.projects.length > 0}
      fallback={
        <p class="px-5 py-6 text-[12px] text-slate-500">No projects yet.</p>
      }
    >
      <div class="overflow-x-auto">
        <table class="w-full min-w-165 text-left text-[12px]">
          <thead class="border-y border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-[.075em] text-slate-500">
            <tr>
              <th class={th}>Project</th>
              <th class={th}>Tasks</th>
              <th class={th}>Open</th>
              <th class={th}>Created</th>
              <th class={th}>
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody class="text-slate-500">
            <For each={props.projects}>
              {(project) => (
                <tr class="border-b border-slate-100 transition hover:bg-slate-50">
                  <td class={td}>
                    <Link
                      to="/projects/$id"
                      params={{ id: String(project.id) }}
                      data-testid="project-link"
                      class="font-bold text-slate-700 hover:text-brand-700"
                    >
                      {project.name}
                    </Link>
                    <span class="mt-0.5 block text-[10px] text-slate-500">
                      {project.description}
                    </span>
                  </td>
                  <td class={td}>{project.taskCount}</td>
                  <td class={td}>{project.openTaskCount}</td>
                  <td class={td}>{formatDate(project.createdAt)}</td>
                  <td class={td}>
                    <div class="flex items-center gap-2">
                      <Link
                        to="/projects/$id/edit"
                        params={{ id: String(project.id) }}
                        aria-label={`Edit ${project.name}`}
                        class="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 underline transition hover:text-brand-700"
                      >
                        Edit
                      </Link>
                      <DeleteProjectButton
                        projectId={project.id}
                        projectName={project.name}
                      />
                    </div>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
