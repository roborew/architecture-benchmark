// src/routes/tasks.index.tsx — the workspace-wide task list.
//
// The data flow is the TanStack Query + Router pattern: the loader warms the
// query cache (`ensureQueryData`) before the route renders, and the component
// reads the same query with `useQuery` — the identical options object
// (src/lib/tasks-query.ts) is what makes the two agree on the cache entry.
// The loader runs once per navigation; `useQuery` re-runs when the search
// param changes, so typing in the search field refreshes the table without a
// manual reload.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { TasksError, TasksRouteError } from "@/components/tasks/tasks-error";
import { TasksPage } from "@/components/tasks/tasks-page";
import { tasksQueryOptions } from "@/lib/tasks-query";
import { parseTasksSearch } from "@/lib/tasks-search";

export const Route = createFileRoute("/tasks/")({
  validateSearch: parseTasksSearch,
  // Re-run the loader when the query changes, so the loader's prefetch
  // follows the search field.
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ deps, context }) =>
    context.queryClient.ensureQueryData(tasksQueryOptions({ q: deps.q })),
  // A failed fetch renders HERE, inside the shell, rather than tearing the
  // route tree down to a blank screen (the router's CatchBoundary fallback).
  errorComponent: TasksRouteError,
  component: TasksRoute,
});

function TasksRoute() {
  const { q } = Route.useSearch();
  const { isPending, isError, error, data } = useQuery(
    tasksQueryOptions({ q }),
  );

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
        <p className="text-[13px] text-slate-500">Loading tasks…</p>
      </div>
    );
  }

  if (isError) {
    // The loader already handled the first failure via errorComponent; this
    // guards a refetch that fails after a successful render.
    return <TasksError error={error} />;
  }

  return <TasksPage tasks={data} />;
}
