// src/routes/tasks.$id.edit.tsx — the edit-task form.
//
// The loader warms the task's own row plus the two option lists the form
// needs (`ensureQueryData`), and the component reads the same queries with
// `useQuery` — the identical options objects (src/queries/*-query.ts) are what
// make the two agree on the cache entries.
//
// The form shows the project as fixed text on an edit rather than as a
// select (spec/contract.md lists the update form's fields as title, status,
// assignee and description only), but it still needs the project list to
// render the name rather than a bare id.
//
// A missing task is `notFound()`, thrown by the loader, with the same markup
// registered as the route's `notFoundComponent` — mirroring the reference
// variant exactly: an inline-looking block with the contract's `not-found`
// testid.

import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { TaskForm } from "@/components/tasks/task-form";
import { TasksError, TasksRouteError } from "@/components/tasks/tasks-error";
import { projectsQueryOptions } from "@/queries/projects-query";
import { taskQueryOptions } from "@/queries/tasks-query";
import { usersQueryOptions } from "@/queries/users-query";

export const Route = createFileRoute("/tasks/$id/edit")({
	loader: async ({ params, context }) => {
		// `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
		// row, so both paths land on the not-found page.
		const taskId = Number(params.id);

		if (!Number.isInteger(taskId)) {
			throw notFound();
		}

		try {
			await context.queryClient.ensureQueryData(taskQueryOptions(taskId));
		} catch (error) {
			// The API answers NOT_FOUND for a missing row: the same not-found page the
			// NaN id produced. Anything else (the API unreachable, a 5xx) is a
			// real error and propagates to the errorComponent.
			if (error instanceof ORPCError && error.code === "NOT_FOUND")
				throw notFound();
			throw error;
		}

		await Promise.all([
			context.queryClient.ensureQueryData(projectsQueryOptions()),
			context.queryClient.ensureQueryData(usersQueryOptions()),
		]);
	},
	notFoundComponent: TaskNotFound,
	// A failed fetch renders HERE, inside the shell, rather than tearing the
	// route tree down to a blank screen (the router's CatchBoundary fallback).
	errorComponent: TasksRouteError,
	component: EditTaskPage,
});

function EditTaskPage() {
	const { id } = Route.useParams();

	const taskQuery = useQuery(taskQueryOptions(Number(id)));
	const projectsQuery = useQuery(projectsQueryOptions());
	const peopleQuery = useQuery(usersQueryOptions());

	if (taskQuery.isPending || projectsQuery.isPending || peopleQuery.isPending) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">Loading task…</p>
			</div>
		);
	}

	if (taskQuery.isError) {
		// The loader already mapped the first NOT_FOUND to the not-found page; this
		// guards a refetch that fails after a successful render.
		if (
			taskQuery.error instanceof ORPCError &&
			taskQuery.error.code === "NOT_FOUND"
		) {
			return <TaskNotFound />;
		}

		return <TasksError error={taskQuery.error} />;
	}

	// The loader already handled the first failure via errorComponent; these
	// guards cover a refetch that fails after a successful render.
	if (projectsQuery.isError) {
		return <TasksError error={projectsQuery.error} />;
	}

	if (peopleQuery.isError) {
		return <TasksError error={peopleQuery.error} />;
	}

	return (
		<TaskForm
			projects={projectsQuery.data}
			people={peopleQuery.data}
			task={taskQuery.data}
		/>
	);
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
