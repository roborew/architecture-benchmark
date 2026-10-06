// src/routes/tasks.$id.index.tsx — one task, its comments, and the comment form.
//
// The Next.js page read the task, then the comments and the member list. All
// three go through server functions here, because a loader also runs in the
// browser during client navigation.

import { Link, createFileRoute } from "@tanstack/react-router";

import { TaskDetail } from "@/components/tasks/task-detail";
import { fetchComments, fetchTask, fetchUsers } from "@/server/queries";

export const Route = createFileRoute("/tasks/$id/")({
  loader: async ({ params }) => {
    const taskId = Number(params.id);

    // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
    // row, so both paths land on the not-found state below. Scoped by id rather
    // than by title, which is what the in-memory fixture lookup did.
    const task = Number.isInteger(taskId)
      ? await fetchTask({ data: { id: taskId } })
      : null;

    if (!task) return null;

    // The comment author select needs every member, not only those already on
    // the task — anyone in the workspace may comment. Both reads are
    // independent, so they run concurrently.
    const [comments, people] = await Promise.all([
      fetchComments({ data: { taskId: task.id } }),
      fetchUsers({ data: { q: "" } }),
    ]);

    return { task, comments, people };
  },
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const data = Route.useLoaderData();

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          Task not found
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          No task matches that id.
        </p>
        <Link
          to="/tasks"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Back to All tasks
        </Link>
      </div>
    );
  }

  return (
    <TaskDetail
      task={data.task}
      comments={data.comments}
      people={data.people}
    />
  );
}
