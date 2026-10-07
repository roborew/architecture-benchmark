// src/routes/index.tsx — the dashboard.
//
// The data flow is the TanStack Query + Router pattern: the loader warms the
// dashboard's one aggregate (`ensureQueryData`) before the route renders, and
// the component reads the same query with `useQuery` — the identical options
// object (src/lib/dashboard-query.ts) is what makes the two agree on the cache
// entry. Stats, recent tasks and the busiest projects arrive together as one
// aggregate, exactly as the reference variant's `fetchDashboard` returns them.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import {
	DashboardError,
	DashboardRouteError,
} from "@/components/dashboard-error";
import { DashboardProjects } from "@/components/dashboard-projects";
import { DashboardStats } from "@/components/dashboard-stats";
import { RecentTasks } from "@/components/recent-tasks";
import { dashboardQueryOptions } from "@/lib/dashboard-query";

const outlineAction =
	"inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50";

const solidAction =
	"inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700";

export const Route = createFileRoute("/")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(dashboardQueryOptions()),
	// A failed fetch renders HERE, inside the shell, rather than tearing the
	// route tree down to a blank screen (the router's CatchBoundary fallback).
	errorComponent: DashboardRouteError,
	component: Home,
});

function QuickAction({ href, label }: { href: string; label: string }) {
	return (
		<a
			href={href}
			className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-left text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50"
		>
			＋ {label}
		</a>
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

function Home() {
	const { isPending, isError, error, data } = useQuery(dashboardQueryOptions());

	if (isPending) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">Loading dashboard…</p>
			</div>
		);
	}

	if (isError) {
		// The loader already handled the first failure via errorComponent; this
		// guards a refetch that fails after a successful render.
		return <DashboardError error={error} />;
	}

	const { stats, recentTasks, projects } = data;

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
					<a href="/users/new" className={outlineAction}>
						＋ New user
					</a>
					<a href="/projects/new" className={outlineAction}>
						＋ New project
					</a>
					<a href="/tasks/new" className={solidAction}>
						＋ New task
					</a>
				</div>
			</div>

			<DashboardStats stats={stats} />

			<div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
				<div className="grid gap-5">
					<RecentTasks tasks={recentTasks} />
					<DashboardProjects projects={projects} />
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
							<SummaryRow label="To do" value={stats.todoTasks} />
							<SummaryRow label="In progress" value={stats.inProgressTasks} />
							<SummaryRow label="Done" value={stats.doneTasks} />
						</dl>
					</section>
				</aside>
			</div>
		</div>
	);
}
