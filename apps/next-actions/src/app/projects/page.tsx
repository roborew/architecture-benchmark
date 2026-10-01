import Link from "next/link";
import { ProjectList } from "./_components/project-list";
import { getProjects } from "@/lib/data";
import { Suspense } from "react";
import { SearchInput } from "../_components/search-input";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const projects = await getProjects((raw ?? "").trim());
  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="mb-2 text-[11px] font-medium text-slate-500">
            Workspace / Projects
          </p>
          <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            Projects
          </h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            Organise work into projects, then add and assign tasks within them.
          </p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
        >
          ＋ New project
        </Link>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
            All projects
          </h2>
          <span className="text-[11px] text-slate-500">
            {projects.length} projects
          </span>
        </div>

        <div className="p-4">
          {/* useSearchParams opts this subtree out of static rendering,
                  so Next requires a Suspense boundary around it. */}
          <Suspense fallback={<div className="h-10" />}>
            <SearchInput
              placeholder="Search projects…"
              label="Search projects"
            />
          </Suspense>
        </div>

        <ProjectList projects={projects} />
      </section>
    </div>
  );
}
