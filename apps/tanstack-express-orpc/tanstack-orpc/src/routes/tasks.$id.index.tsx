// src/routes/tasks.$id.index.tsx — one task, its comments, and the comment form.
//
// The data flow is the TanStack Query + Router pattern: the loader warms the
// task's own row, its comments, and the member list (`ensureQueryData`)
// before the route renders, and the component reads the same queries with
// `useQuery` — the identical options objects (src/queries/*-query.ts) are what
// make the two agree on the cache entries.
//
// The not-found outcome is a rendered state rather than `notFound()`, because
// that is what the reference variant does: the loader returns null for an id
// that matches no row (or is not a number at all) and the component renders
// the inline block with a way back to the list.

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ORPCError } from "@orpc/client";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TasksError, TasksRouteError } from "@/components/tasks/tasks-error";
import { commentsQueryOptions } from "@/queries/comments-query";
import { taskQueryOptions } from "@/queries/tasks-query";
import { usersQueryOptions } from "@/queries/users-query";

export const Route = createFileRoute("/tasks/$id/")({
  loader: async ({ params, context }) => {
    // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
    // row, so both paths land on the not-found state in the component.
    const taskId = Number(params.id);

    if (!Number.isInteger(taskId)) return null;

    try {
      await context.queryClient.ensureQueryData(taskQueryOptions(taskId));
    } catch (error) {
      // The API answers NOT_FOUND for a missing row; that is the not-found state
      // the component renders, not an error page. Anything else (the API
      // unreachable, a 5xx) is a real error and propagates to the
      // errorComponent.
      if (error instanceof ORPCError && error.code === "NOT_FOUND") return null;
      throw error;
    }

    // The comment author select needs every member, not only those already on
    // the task — anyone in the workspace may comment. Both reads are
    // independent, so they are warmed concurrently.
    await Promise.all([
      context.queryClient.ensureQueryData(commentsQueryOptions(taskId)),
      context.queryClient.ensureQueryData(usersQueryOptions()),
    ]);
  },
  // A failed fetch renders HERE, inside the shell, rather than tearing the
  // route tree down to a blank screen (the router's CatchBoundary fallback).
  errorComponent: TasksRouteError,
  component: TaskDetailRoute,
});

/** The task detail's inline not-found state, mirroring the reference's. */
function TaskNotFound() {
  return (
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
  );
}

function TaskDetailRoute() {
  const { id } = Route.useParams();

  // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
  // row, so both paths land on the not-found state below.
  const taskId = Number(id);
  const isValid = Number.isInteger(taskId);

  // The queries are declared unconditionally (hooks cannot be called
  // conditionally); an invalid id leaves them disabled, so nothing is fetched
  // for a URL the detail page cannot answer.
  const taskQuery = useQuery({
    ...taskQueryOptions(taskId),
    enabled: isValid,
  });
  const commentsQuery = useQuery({
    ...commentsQueryOptions(taskId),
    enabled: isValid,
  });
  const peopleQuery = useQuery(usersQueryOptions());

  if (!isValid) {
    return <TaskNotFound />;
  }

  if (taskQuery.isPending || commentsQuery.isPending || peopleQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
        <p className="text-[13px] text-slate-500">Loading task…</p>
      </div>
    );
  }

  if (taskQuery.isError) {
    // A NOT_FOUND from the API is the same not-found state the loader mapped to
    // null: the component guards a refetch that fails after a successful
    // render (the task was deleted in another tab).
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
  if (commentsQuery.isError) {
    return <TasksError error={commentsQuery.error} />;
  }

  if (peopleQuery.isError) {
    return <TasksError error={peopleQuery.error} />;
  }

  return (
    <TaskDetail
      task={taskQuery.data}
      comments={commentsQuery.data}
      people={peopleQuery.data}
    />
  );
}
