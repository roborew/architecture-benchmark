import Link from "next/link";
import { TaskDetail } from "./_components/task-detail";
import { allTasks, taskComments } from "@/lib/seed-data";

export default async function TaskDetailPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;

  const task = allTasks.find((candidate) => candidate.id === Number(id));

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

  const comments = taskComments.filter((comment) => comment.taskId === task.id);

  return <TaskDetail task={task} comments={comments} />;
}
