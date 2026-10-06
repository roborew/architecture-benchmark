// src/routes/projects.$id.edit.tsx — the edit-project form.
//
// Next rendered a `not-found.tsx` beside this page and threw `notFound()` for
// a missing project. Here the same throw comes from the router, and the same
// markup is registered as the route's `notFoundComponent`.

import { Link, createFileRoute, notFound } from "@tanstack/solid-router";

import { ProjectForm } from "@/components/projects/project-form";
import { fetchProject } from "@/server/queries";

export const Route = createFileRoute("/projects/$id/edit")({
  loader: async ({ params }) => {
    const projectId = Number(params.id);

    // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
    // row, so both paths land on the not-found page.
    const project = Number.isInteger(projectId)
      ? await fetchProject({ data: { id: projectId } })
      : null;

    if (!project) {
      throw notFound();
    }

    return project;
  },
  notFoundComponent: ProjectNotFound,
  component: EditProjectPage,
});

function EditProjectPage() {
  const project = Route.useLoaderData();

  return <ProjectForm project={project()} />;
}

function ProjectNotFound() {
  return (
    <div data-testid="not-found">
      <div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
        <h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          Project not found
        </h1>
        <p class="mt-1.5 text-[13px] leading-6 text-slate-500">
          No project matches that id.
        </p>
        <Link
          to="/projects"
          class="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Back to Projects
        </Link>
      </div>
    </div>
  );
}
