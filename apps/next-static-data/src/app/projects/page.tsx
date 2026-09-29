import { ProjectList } from "@/app/projects/_components/project-list";
import { projects } from "@/lib/seed-data";

export default function ProjectPage() {
  return (
    <div>
      <h1>Projects</h1>
      <div>{projects.length} Projects</div>
      <ProjectList projects={projects} />
    </div>
  );
}
