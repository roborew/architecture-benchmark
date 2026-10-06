// src/routes/index.tsx — the dashboard.
//
// The Next.js page was an async Server Component reading three aggregates
// directly. Here the work happens in a loader calling a server function: a
// loader runs on the server for the first request *and in the browser* during
// client navigation, so it must never touch the database itself.

import { createFileRoute } from "@tanstack/solid-router";

import { DashboardProjects } from "@/components/dashboard-projects";
import { DashboardStats } from "@/components/dashboard-stats";
import { RecentTasks } from "@/components/recent-tasks";
import { fetchDashboard } from "@/server/queries";

const outlineAction =
	"inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50";

const solidAction =
	"inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700";

export const Route = createFileRoute("/")({
	loader: () => fetchDashboard(),
	component: Home,
});

function QuickAction(props: { href: string; label: string }) {
	return (
		<a
			href={props.href}
			class="rounded-lg border border-slate-200 bg-white px-3 py-3 text-left text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50"
		>
			＋ {props.label}
		</a>
	);
}

function SummaryRow(props: { label: string; value: number }) {
	return (
		<div class="flex justify-between border-b border-slate-100 py-2.5 last:border-0">
			<dt class="text-slate-500">{props.label}</dt>
			<dd class="font-bold text-slate-700">{props.value}</dd>
		</div>
	);
}

function Home() {
	const data = Route.useLoaderData();

	return (
		<div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
			<div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
				<div>
					<h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
						Dashboard
					</h1>
					<p class="mt-1.5 text-[13px] leading-6 text-slate-500">
						An overview of projects, work in progress, and recent task activity.
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<a href="/users/new" class={outlineAction}>
						＋ New user
					</a>
					<a href="/projects/new" class={outlineAction}>
						＋ New project
					</a>
					<a href="/tasks/new" class={solidAction}>
						＋ New task
					</a>
				</div>
			</div>

			<DashboardStats stats={data().stats} />

			<div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
				<div class="grid gap-5">
					<RecentTasks tasks={data().recentTasks} />
					<DashboardProjects projects={data().projects} />
				</div>

				<aside class="grid gap-5">
					<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
						<div class="border-b border-slate-100 px-5 py-4">
							<h2 class="text-[15px] font-bold tracking-[-.02em] text-slate-800">
								Quick actions
							</h2>
						</div>
						<div class="grid gap-2 p-4">
							<QuickAction href="/projects/new" label="Create a project" />
							<QuickAction href="/tasks/new" label="Add a task" />
							<QuickAction href="/users/new" label="Add a workspace member" />
						</div>
					</section>

					<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
						<div class="border-b border-slate-100 px-5 py-4">
							<h2 class="text-[15px] font-bold tracking-[-.02em] text-slate-800">
								Work summary
							</h2>
						</div>
						<dl class="p-5 text-[12px]">
							<SummaryRow label="To do" value={data().stats.todoTasks} />
							<SummaryRow
								label="In progress"
								value={data().stats.inProgressTasks}
							/>
							<SummaryRow label="Done" value={data().stats.doneTasks} />
						</dl>
					</section>
				</aside>
			</div>
		</div>
	);
}
