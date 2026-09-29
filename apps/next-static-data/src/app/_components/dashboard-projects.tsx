import Link from "next/link";
import type { DashboardProject } from "@/types";

export function DashboardProjects({
  projects,
}: {
  projects: DashboardProject[];
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
            Projects
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Open a project to view and manage its tasks
          </p>
        </div>
        <Link
          href="/projects"
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          View projects
        </Link>
      </div>

      <ul className="grid gap-3 p-5 sm:grid-cols-2">
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}`}
              className="block rounded-xl border border-slate-200 bg-white p-4 text-left shadow-panel transition hover:border-brand-200 hover:bg-brand-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-700">{project.name}</h3>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    {project.description}
                  </p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                  {project.taskCount}
                </span>
              </div>
              <div className="mt-4 flex gap-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                <b className="text-slate-700">{project.openTaskCount}</b> open
                <b className="text-slate-700">{project.peopleCount}</b> people
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
