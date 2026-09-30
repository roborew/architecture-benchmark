import Link from "next/link";
import type { TaskWithProject } from "@/lib/types";
import { StatusBadge } from "@/app/_components/status-badge";

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
              className="border-b border-slate-100 transition hover:bg-slate-50"
            >
              <td className={td}>
                <Link
                  href={`/tasks/${task.id}`}
                  className="font-bold text-slate-700 hover:text-brand-700"
                >
                  {task.title}
                </Link>
                <span className="mt-0.5 block text-[10px] text-slate-500">
                  #{task.id}
                </span>
              </td>
              {showProject && <td className={td}>{task.projectName}</td>}
              <td className={td}>
                <StatusBadge status={task.status} />
              </td>
              <td className={td}>
                <span
                  aria-hidden="true"
                  className="mr-1.5 inline-grid h-6 w-6 place-items-center rounded-full bg-indigo-50 align-middle text-[9px] font-extrabold text-indigo-600"
                >
                  {initials(task.assigneeName)}
                </span>
                {task.assigneeName}
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
