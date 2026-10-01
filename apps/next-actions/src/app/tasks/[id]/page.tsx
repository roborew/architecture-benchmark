import Link from "next/link";
import { TaskDetail } from "./_components/task-detail";
import { getComments, getTask, getUsers } from "@/lib/data";

export default async function TaskDetailPage({
  params,
}: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  const taskId = Number(id);

  // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
  // row, so both paths land on the not-found state below. Scoped by id rather
  // than by title, which is what the in-memory fixture lookup did.
  const task = Number.isInteger(taskId) ? await getTask(taskId) : null;

  if (!task) {
    return (
      <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
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
  const [comments, people] = await Promise.all([
    getComments(task.id),
    getUsers(),
  ]);

  return <TaskDetail task={task} comments={comments} people={people} />;
}
