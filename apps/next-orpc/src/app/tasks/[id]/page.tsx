import Link from "next/link";
import { TaskDetail } from "./_components/task-detail";
import { getQueryClient, orpc } from "@/orpc/server";

export default async function TaskDetailPage({
  params,
}: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  const taskId = Number(id);

  // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
  // row, so both paths land on the not-found state below. Scoped by id rather
  // than by title, which is what the in-memory fixture lookup did.
  const task = Number.isInteger(taskId)
    ? await getQueryClient().fetchQuery(
        orpc.tasks.byId.queryOptions({ input: { id: taskId } }),
      )
    : null;

  if (!task) {
    return (
      <div
        data-testid="not-found"
        className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9"
      >
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          Task not found
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          No task matches that id.
        </p>
        <Link
          href="/tasks"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Back to All tasks
        </Link>
      </div>
    );
  }

  // The comment author select needs every member, not only those already on the
  // task — anyone in the workspace may comment. Both reads are independent, so
  // they run concurrently.
  const queryClient = getQueryClient();
  const [comments, people] = await Promise.all([
    queryClient.fetchQuery(
      orpc.tasks.comments.queryOptions({ input: { id: task.id } }),
    ),
    queryClient.fetchQuery(
      orpc.users.list.queryOptions({ input: { search: "" } }),
    ),
  ]);

  return <TaskDetail task={task} comments={comments} people={people} />;
}
