// src/routes/tasks.$id.edit.tsx — the edit-task form.
//
// Next rendered a `not-found.tsx` beside this page and threw `notFound()` for
// a missing task. Here the same throw comes from the router, and the same
// markup is registered as the route's `notFoundComponent`.

import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { TaskForm } from "@/components/tasks/task-form";
import { fetchTask, fetchTaskFormOptions } from "@/server/queries";

export const Route = createFileRoute("/tasks/$id/edit")({
  loader: async ({ params }) => {
    const taskId = Number(params.id);

    // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
    // row, so both paths land on the not-found page.
    const task = Number.isInteger(taskId)
      ? await fetchTask({ data: { id: taskId } })
      : null;

    if (!task) {
      throw notFound();
    }

    // The form shows the project as fixed text on an edit rather than as a
    // select, but it still needs the project list to render the name rather
    // than a bare id.
    const { projects, people } = await fetchTaskFormOptions();

    return { task, projects, people };
  },
  notFoundComponent: TaskNotFound,
  component: EditTaskPage,
});

function EditTaskPage() {
  const { task, projects, people } = Route.useLoaderData();

  return <TaskForm projects={projects} people={people} task={task} />;
}

function TaskNotFound() {
  return (
    <div data-testid="not-found">
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
    </div>
  );
}
