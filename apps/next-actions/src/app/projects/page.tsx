import { ProjectList } from "@/app/projects/_components/project-list";
import { projects } from "@/lib/seed-data";

export default function ProjectPage() {
  return (
    <div data-testid="projects-list-ready">
      <h1>Projects</h1>
      <div>{projects.length} Projects</div>
      <ProjectList projects={projects} />
    </div>
  );
}
