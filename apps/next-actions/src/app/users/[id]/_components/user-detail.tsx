import Link from "next/link";
import type { User } from "@/lib/types";
import { TaskTable } from "@/app/tasks/_components/task-table";
import type { TaskWithProject } from "@/lib/types";
import { DeleteUserButton } from "@/app/users/_components/delete-user-button";

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

export function UserDetail({
  person,
  tasks,
}: {
  person: User;
  tasks: TaskWithProject[];
}) {
  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="mb-2 text-[11px] font-medium text-slate-500">
            <Link href="/users" className="hover:text-brand-600">
              People
            </Link>{" "}
            / {person.name}
          </p>
          <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            {person.name}
          </h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            {person.email}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/users/${person.id}/edit`}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Edit user
          </Link>
          <DeleteUserButton person={person} />
        </div>
      </div>

      <section className="mb-5 grid grid-cols-2 gap-3">
        <StatCard
          label="Assigned tasks"
          value={person.assignedTaskCount}
          hint="Across projects"
        />
        <StatCard
          label="Comments authored"
          value={person.commentCount}
          hint="On assigned tasks"
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
            Assigned tasks
          </h2>
        </div>
        {/* TaskTable has its own empty state, so it is only rendered
            when there is something to show. The reference shows
            Project here but not Comments. */}
        {tasks.length === 0 ? (
          <p className="px-5 py-6 text-[12px] text-slate-500">
            No tasks are assigned to this person.
          </p>
        ) : (
          <TaskTable tasks={tasks} showProject />
        )}
      </section>
    </div>
  );
}
