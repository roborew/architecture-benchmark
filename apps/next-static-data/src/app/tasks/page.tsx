import Link from "next/link";
import { TaskFilters } from "./_components/task-filters";
import { TaskTable } from "./_components/task-table";
import { allTasks, projects, people } from "@/lib/seed-data";

const PAGE_SIZE = 4;

export default function TasksPage() {
  const page = allTasks.slice(0, PAGE_SIZE);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="mb-2 text-[11px] font-medium text-slate-400">
            Workspace / All tasks
          </p>
          <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            All tasks
          </h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            A workspace-wide view of tasks across every project.
          </p>
        </div>
        <Link
          href="/tasks/new"
          className="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
        >
          ＋ New task
        </Link>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        <TaskFilters projects={projects} people={people} />

        <TaskTable tasks={page} showProject showComments />

        <div className="flex items-center justify-between px-5 py-4 text-[11px] text-slate-400">
          <span>
            Showing 1-{page.length} of {allTasks.length}
          </span>
          {/* Chrome only for now: Next is enabled but does not paginate. */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
