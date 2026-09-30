import Link from "next/link";
import { ProjectDetail } from "@/app/projects/_components/project-detail";
import { allTasks, projects } from "@/lib/seed-data";

export default async function ProjectDetailPage({
  params,
}: PageProps<"/projects/[id]">) {
  const { id } = await params;

  const project = projects.find((candidate) => candidate.id === Number(id));

  if (!project) {
    return (
      <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          Project not found
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          No project matches that id.
        </p>
        <Link
          href="/projects"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Back to Projects
        </Link>
      </div>
    );
  }

  // allTasks already carries the project name the table needs, so the
  // rows are filtered by projectId rather than re-derived.
  const tasks = allTasks.filter((task) => task.projectId === project.id);

  return <ProjectDetail project={project} tasks={tasks} />;
}
