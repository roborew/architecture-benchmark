import type { Project, Task } from "@/types";

export function ProjectDetail({
  project,
  tasks,
}: {
  project: Project;
  tasks: Task[];
}) {
  return (
    <div>
      <h1>{project.name}</h1>
      <p>{project.description}</p>
      <p>Tasks {project.taskCount}</p>
      <p>
        <span>Open</span>
      </p>
      <p>
        <span>People</span> To add
      </p>
      <p>TaskCount {project.openTaskCount}</p>
      {tasks.length === 0 && <p>No tasks in this project yet.</p>}
      <h2>Tasks</h2>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Assignee</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>{task.id}</td>
              <td>{task.title}</td>
              <td>
                {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
              </td>
              <td>{task.assigneeName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
