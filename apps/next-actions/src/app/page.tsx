import Link from "next/link";
import { DashboardStats } from "./_components/dashboard-stats";
import { RecentTasks } from "./_components/recent-tasks";
import { DashboardProjects } from "./_components/dashboard-projects";
import {
  dashboardStats,
  dashboardRecentTasks,
  dashboardProjects,
} from "@tests/fixtures/data";

const outlineAction =
  "inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50";

const solidAction =
  "inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700";

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-left text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50"
    >
      ＋ {label}
    </Link>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-2.5 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-bold text-slate-700">{value}</dd>
    </div>
  );
}

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            Dashboard
          </h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            An overview of projects, work in progress, and recent task activity.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/users/new" className={outlineAction}>
            ＋ New user
          </Link>
          <Link href="/projects/new" className={outlineAction}>
            ＋ New project
          </Link>
          <Link href="/tasks/new" className={solidAction}>
            ＋ New task
          </Link>
        </div>
      </div>

      <DashboardStats stats={dashboardStats} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="grid gap-5">
          <RecentTasks tasks={dashboardRecentTasks} />
          <DashboardProjects projects={dashboardProjects} />
        </div>

        <aside className="grid gap-5">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Quick actions
              </h2>
            </div>
            <div className="grid gap-2 p-4">
              <QuickAction href="/projects/new" label="Create a project" />
              <QuickAction href="/tasks/new" label="Add a task" />
              <QuickAction href="/users/new" label="Add a workspace member" />
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Work summary
              </h2>
            </div>
            <dl className="p-5 text-[12px]">
              <SummaryRow label="To do" value={dashboardStats.todoTasks} />
              <SummaryRow
                label="In progress"
                value={dashboardStats.inProgressTasks}
              />
              <SummaryRow label="Done" value={dashboardStats.doneTasks} />
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
