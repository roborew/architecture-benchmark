import { notFound } from "next/navigation";
import { ProjectForm } from "@/app/projects/_components/project-form";
import { getProject } from "@/lib/data";

export default async function EditProjectPage({
  params,
}: PageProps<"/projects/[id]/edit">) {
  const { id } = await params;
  const projectId = Number(id);

  // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
  // row, so both paths land on the not-found page.
  const project = Number.isInteger(projectId)
    ? await getProject(projectId)
    : null;

  if (!project) {
    notFound();
  }

  return <ProjectForm project={project} />;
}
