import { notFound } from "next/navigation";
import { TaskForm } from "@/app/tasks/new/_components/task-form";
import { getQueryClient, trpc } from "@/trpc/server";

export default async function EditTaskPage({
  params,
}: PageProps<"/tasks/[id]/edit">) {
  const { id } = await params;
  const taskId = Number(id);

  // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
  // row, so both paths land on the not-found page.
  const task = Number.isInteger(taskId)
    ? await getQueryClient().fetchQuery(
        trpc.tasks.byId.queryOptions({ id: taskId }),
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
    queryClient.fetchQuery(trpc.users.list.queryOptions({ search: "" })),
    queryClient.fetchQuery(trpc.projects.list.queryOptions({ search: "" })),
  ]);

  return <TaskForm projects={projects} people={people} task={task} />;
}
