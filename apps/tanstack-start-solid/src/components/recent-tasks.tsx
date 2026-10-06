import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";

import type { DashboardTask } from "@/lib/types";
import { StatusBadge } from "./status-badge";

const th = "px-3 py-3 first:px-5 last:px-5";
const td = "px-3 py-3.5 first:px-5 last:px-5";

export function RecentTasks(props: { tasks: DashboardTask[] }) {
  return (
    <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
      <div class="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 class="text-[15px] font-bold tracking-[-.02em] text-slate-800">
            Recent tasks
          </h2>
          <p class="mt-0.5 text-[11px] text-slate-500">
            Latest task activity across every project
          </p>
        </div>
        <Link
          to="/tasks"
          class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          View all tasks
        </Link>
      </div>

      <Show
        when={props.tasks.length > 0}
        fallback={
          <p class="px-5 py-6 text-[12px] text-slate-500">
            No recent task activity.
          </p>
        }
      >
        <div class="overflow-x-auto">
          <table class="w-full min-w-165 text-left text-[12px]">
            <thead class="border-y border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-[.075em] text-slate-500">
              <tr>
                <th class={th}>Task</th>
                <th class={th}>Status</th>
                <th class={th}>Assignee</th>
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
                        {task.projectName}
                      </span>
                    </td>
                    <td class={td}>
                      <StatusBadge status={task.status} />
                    </td>
                    <td class={td}>{task.assigneeName}</td>
                    <td class={td}>{task.updatedAt}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}
