// src/routes/tasks.new.tsx — the create-task forms.
//
// The form's Project and Assigned user selects are populated from the API,
// not a fixture: offering a member or project that no longer exists would
// produce a validation error the user cannot resolve from this page. The
// loader warms both lists (`ensureQueryData`) and the component reads the same
// queries with `useQuery` — the identical options objects are what make the
// two agree on the cache entries.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { TaskForm } from "@/components/tasks/task-form";
import { TasksError, TasksRouteError } from "@/components/tasks/tasks-error";
import { projectsQueryOptions } from "@/queries/projects-query";
import { usersQueryOptions } from "@/queries/users-query";

export const Route = createFileRoute("/tasks/new")({
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(projectsQueryOptions()),
			context.queryClient.ensureQueryData(usersQueryOptions()),
		]);
	},
	// A failed fetch renders HERE, inside the shell, rather than tearing the
	// route tree down to a blank screen (the router's CatchBoundary fallback).
	errorComponent: TasksRouteError,
	component: NewTaskPage,
});

function NewTaskPage() {
	const projectsQuery = useQuery(projectsQueryOptions());
	const peopleQuery = useQuery(usersQueryOptions());

	if (projectsQuery.isPending || peopleQuery.isPending) {
		return (
			<div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
				<p className="text-[13px] text-slate-500">Loading form…</p>
			</div>
		);
	}

	// The loader already handled the first failure via errorComponent; these
	// guards cover a refetch that fails after a successful render.
	if (projectsQuery.isError) {
		return <TasksError error={projectsQuery.error} />;
	}

	if (peopleQuery.isError) {
		return <TasksError error={peopleQuery.error} />;
	}

	return <TaskForm projects={projectsQuery.data} people={peopleQuery.data} />;
}
