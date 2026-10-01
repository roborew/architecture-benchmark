import { notFound } from "next/navigation";
import { TaskForm } from "@/app/tasks/new/_components/task-form";
import { getProjects, getTask, getUsers } from "@/lib/data";

export default async function EditTaskPage({
  params,
}: PageProps<"/tasks/[id]/edit">) {
  const { id } = await params;
  const taskId = Number(id);

  // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
  // row, so both paths land on the not-found page.
  const task = Number.isInteger(taskId) ? await getTask(taskId) : null;

  if (!task) {
    notFound();
  }

  // The form shows the project as fixed text on an edit rather than as a
  // select, but it still needs the project list to render the name rather
  // than a bare id.
  const [people, projects] = await Promise.all([getUsers(), getProjects()]);

  return <TaskForm projects={projects} people={people} task={task} />;
}
