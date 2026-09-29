import type { Project } from "@/types";

export function ProjectList({ projects }: { projects: Project[] }) {
  return (
    <div>
      {projects.length === 0 && <p>No projects yet.</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Task Count</th>
            <th>Open Task Count</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td>{project.name}</td>
              <td>{project.description}</td>
              <td>{project.taskCount}</td>
              <td>{project.openTaskCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
