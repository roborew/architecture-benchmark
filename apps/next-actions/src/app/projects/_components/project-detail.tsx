import Link from "next/link";
import type { Project, ProjectTaskRow } from "@/lib/types";
import { TaskTable } from "@/app/tasks/_components/task-table";

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-panel sm:p-5">
      <span className="block text-[11px] font-semibold text-slate-500">
        {label}
      </span>
      <strong className="mt-2 block text-[24px] font-extrabold tracking-[-.045em] text-slate-800">
        {value}
      </strong>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

export function ProjectDetail({
  project,
  tasks,
  status = "",
  hasMore = false,
}: {
  project: Project;
  tasks: ProjectTaskRow[];
  status?: string;
  /** Whether the query filled its page, i.e. whether older rows probably exist. */
  hasMore?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="mb-2 text-[11px] font-medium text-slate-500">
            <Link href="/projects" className="hover:text-brand-600">
              Projects
            </Link>{" "}
            / {project.name}
          </p>
          <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            {project.name}
          </h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            {project.description}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/projects/${project.id}/edit`}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Edit project
          </Link>
          <Link
            href="/tasks/new"
            className="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
          >
            ＋ New task
          </Link>
        </div>
      </div>

      <section className="mb-5 grid grid-cols-3 gap-3">
        <StatCard
          label="Tasks"
          value={project.taskCount}
          hint="In this project"
        />
        <StatCard
          label="Open"
          value={project.openTaskCount}
          hint="Not done yet"
        />
        <StatCard
          label="People"
          value={project.peopleCount}
          hint="Assigned members"
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
            Project tasks
          </h2>
          {/* The select is a plain GET form so filtering needs no client
              state and the applied filter lives in the URL. */}
          <form className="flex gap-2" method="get">
            <label className="relative block">
              <span className="sr-only">Search tasks</span>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-2 text-slate-500"
              >
                ⌕
              </span>
              <input
                type="search"
                name="q"
                placeholder="Search tasks…"
                className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-[11px] outline-none focus:border-brand-500 sm:w-48"
              />
            </label>
            <select
              aria-label="Status"
              name="status"
              // Remount on change so the browser follows the GET form. Without
              // a key, React keeps the pre-change value and the submission
              // carries the status the user just navigated away from.
              key={status}
              defaultValue={status}
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px] text-slate-700 outline-none focus:border-brand-500"
            >
              <option value="">All statuses</option>
              <option value="todo">To do</option>
              <option value="in-progress">In progress</option>
              <option value="done">Done</option>
            </select>
            {/* Filters are single-select; on submit keep whichever one was set. */}
            <button type="submit" className="sr-only">
              Apply
            </button>
          </form>
        </div>

        {/* The project is implied by the page, so the table shows
            comments but no project column. */}
        {tasks.length === 0 ? (
          <p className="px-5 py-6 text-[12px] text-slate-500">
            No tasks in this project yet.
          </p>
        ) : (
          <>
            <TaskTable tasks={tasks} showComments />

            {/* Keyset pagination (spec/queries.md): the cursor carries the
                `(created_at, id)` of the last row shown, so the next page
                starts exactly after it. The status is carried too, or the
                filter would silently reset while the select still shows it. */}
            {hasMore && tasks.length > 0 ? (
              <div className="flex justify-end border-t border-slate-100 px-5 py-4">
                <Link
                  href={`/projects/${project.id}?${
                    status ? `status=${encodeURIComponent(status)}&` : ""
                  }cursor=${encodeURIComponent(
                    tasks[tasks.length - 1].cursorFor,
                  )}`}
                  data-testid="next-page"
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Older tasks
                </Link>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
