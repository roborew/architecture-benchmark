import { notFound } from "next/navigation";
import { TaskForm } from "@/app/tasks/new/_components/task-form";
import { getQueryClient, orpc } from "@/orpc/server";

export default async function EditTaskPage({
  params,
}: PageProps<"/tasks/[id]/edit">) {
  const { id } = await params;
  const taskId = Number(id);

  // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
  // row, so both paths land on the not-found page.
  const task = Number.isInteger(taskId)
    ? await getQueryClient().fetchQuery(
        orpc.tasks.byId.queryOptions({ input: { id: taskId } }),
      )
    : null;

  if (!task) {
    notFound();
  }

  // The form shows the project as fixed text on an edit rather than as a
  // select, but it still needs the project list to render the name rather
  // than a bare id.
  const queryClient = getQueryClient();
  const [people, projects] = await Promise.all([
    queryClient.fetchQuery(
      orpc.users.list.queryOptions({ input: { search: "" } }),
    ),
    queryClient.fetchQuery(
      orpc.projects.list.queryOptions({ input: { search: "" } }),
    ),
  ]);

  return <TaskForm projects={projects} people={people} task={task} />;
}
