import Link from "next/link";
import type { Project } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { DeleteProjectButton } from "./delete-project-button";

const th = "px-3 py-3 first:px-5 last:px-5";
const td = "px-3 py-3.5 first:px-5 last:px-5";

export function ProjectList({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return (
      <p className="px-5 py-6 text-[12px] text-slate-500">No projects yet.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-165 text-left text-[12px]">
        <thead className="border-y border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-[.075em] text-slate-500">
          <tr>
            <th className={th}>Project</th>
            <th className={th}>Tasks</th>
            <th className={th}>Open</th>
            <th className={th}>Created</th>
            <th className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="text-slate-500">
          {projects.map((project) => (
            <tr
              key={project.id}
              className="border-b border-slate-100 transition hover:bg-slate-50"
            >
              <td className={td}>
                <Link
                  href={`/projects/${project.id}`}
                  data-testid="project-link"
                  className="font-bold text-slate-700 hover:text-brand-700"
                >
                  {project.name}
                </Link>
                <span className="mt-0.5 block text-[10px] text-slate-500">
                  {project.description}
                </span>
              </td>
              <td className={td}>{project.taskCount}</td>
              <td className={td}>{project.openTaskCount}</td>
              <td className={td}>{formatDate(project.createdAt)}</td>
              <td className={td}>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/projects/${project.id}/edit`}
                    aria-label={`Edit ${project.name}`}
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 underline transition hover:text-brand-700"
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
