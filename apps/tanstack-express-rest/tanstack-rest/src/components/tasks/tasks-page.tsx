import { SearchInput } from "@/components/search-input";
import { UserTable } from "@/components/users/user-table";
import { TaskTable } from "./task-table";
import { Link } from "@tanstack/react-router";
import type { Task } from "#/lib/types";

export function TasksPage({ tasks }: { tasks: Task[] }) {
  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="mb-2 text-[11px] font-medium text-slate-500">
            Workspace / All tasks
          </p>
          <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            All tasks
          </h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            A workspace-wide view of tasks across every project.
          </p>
        </div>
        {/*<Link
          to="/tasks/new"
          className="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
        >
          ＋ New task
        </Link>*/}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        {/*<TaskFilters
          projects={data.projects}
          people={data.people}
          search={data.filters.search}
          status={data.filters.status}
          projectId={data.filters.projectId}
          assigneeId={data.filters.assigneeId}
        />*/}

        <TaskTable tasks={tasks} showProject showComments />

        <div className="flex items-center justify-between px-5 py-4 text-[11px] text-slate-500">
          {/*<span>{formatRange({ ...data.range, filtered: data.filtered })}</span>*/}
          {/* Keyset pagination (spec/queries.md). */}
          {/*<TaskPagination
            hasNewer={data.onLaterPage}
            hasOlder={data.hasMore}
            firstSearch={data.firstSearch}
            nextSearch={data.nextSearch}
            size={data.size}
          />*/}
        </div>
      </section>
    </div>
  );
}
