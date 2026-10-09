"use client";

// The task detail body.
//
// It is a Client Component because the add-comment form and the delete control
// both call tRPC mutations and need the pending flags and validation state that
// come with them. The task and its comments arrive as props already read by the
// page, so no data fetching happens here.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Comment, TaskWithProject, User } from "@/lib/types";
import { StatusBadge } from "@/app/_components/status-badge";
import type { ActionResult, FieldErrors } from "@/trpc/result";
import { useTRPC } from "@/trpc/client";
import { initials } from "@/lib/initials";

type FormState = { errors?: FieldErrors; message?: string | null };

const fieldLabel =
  "text-[10px] font-bold uppercase tracking-[.08em] text-slate-500";

function DetailsRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <dt className={fieldLabel}>{label}</dt>
      <dd className="mt-1 font-semibold text-slate-700">{children}</dd>
    </div>
  );
}

/** The add-comment form. Split out so it owns its own mutation state. */
function AddCommentForm({
  taskId,
  people,
}: {
  taskId: number;
  people: User[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [state, setState] = useState<FormState>({});

  // Controlled rather than `defaultValue`: a rejected submit must not blank the
  // draft — precisely when the user needs to see what they wrote.
  const [body, setBody] = useState("");

  const added = useMutation(
    trpc.comments.create.mutationOptions({
      onSuccess: async (result: ActionResult) => {
        if (!result.ok) {
          setState({ errors: result.errors, message: result.message });
          return;
        }

        // No navigation: the user stays here and sees the comment they just
        // wrote in the list above the form. What does change is the comment count
        // on both this page and the list, so both are re-read.
        setState({});
        setBody("");

        await Promise.all([
          queryClient.invalidateQueries(trpc.tasks.comments.queryFilter()),
          queryClient.invalidateQueries(trpc.tasks.list.queryFilter()),
          queryClient.invalidateQueries(trpc.tasks.count.queryFilter()),
          queryClient.invalidateQueries(trpc.projects.tasks.queryFilter()),
        ]);
      },
      onError: () =>
        setState({ message: "Database Error: Failed to add the comment." }),
    }),
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({});

    const authorId = Number(
      new FormData(event.currentTarget).get("commentAuthorId"),
    );

    added.mutate({ taskId, commentBody: body, commentAuthorId: authorId });
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-slate-100 p-5">
      {state.message ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] font-semibold text-red-700"
        >
          {state.message}
        </p>
      ) : null}

      <label
        htmlFor="comment-body"
        className="mb-1.5 block text-[11px] font-bold text-slate-600"
      >
        Add comment
      </label>
      <textarea
        id="comment-body"
        name="commentBody"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        aria-invalid={state.errors?.commentBody ? true : undefined}
        aria-describedby={
          state.errors?.commentBody ? "comment-body-error" : undefined
        }
        placeholder="Write a comment…"
        className="mb-4 min-h-23 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-[12px] text-slate-700 outline-none placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
      {state.errors?.commentBody ? (
        <p
          id="comment-body-error"
          className="-mt-2 mb-3 text-[11px] font-semibold text-red-600"
        >
          {state.errors.commentBody[0]}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <label htmlFor="comment-author" className="text-[11px] text-slate-500">
          Author
          <select
            id="comment-author"
            name="commentAuthorId"
            className="ml-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={added.isPending}
          className="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700 disabled:opacity-50"
        >
          {added.isPending ? "Adding…" : "Add comment"}
        </button>
      </div>
    </form>
  );
}

/**
 * The delete control.
 *
 * On success the user lands on the board the task belonged to, not on the task:
 * the detail page for this id is now not-found, so navigating there would leave
 * them on a dead URL.
 */
function DeleteTaskButton({
  taskId,
  projectId,
  title,
}: {
  taskId: number;
  /** The board to return to, read by the page before the row is gone. */
  projectId: number;
  title: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const deleted = useMutation(
    trpc.tasks.delete.mutationOptions({
      onSuccess: async (result: ActionResult) => {
        if (!result.ok) {
          setMessage(result.message ?? "Failed to delete task.");
          return;
        }

        await Promise.all([
          queryClient.invalidateQueries(trpc.tasks.list.queryFilter()),
          queryClient.invalidateQueries(trpc.tasks.count.queryFilter()),
          queryClient.invalidateQueries(trpc.projects.tasks.queryFilter()),
        ]);

        router.push(`/projects/${projectId}`);
      },
      onError: () => setMessage("Database Error: Failed to delete task."),
    }),
  );

  return (
    <form
      className="inline"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        deleted.mutate({ id: taskId });
      }}
    >
      <button
        type="submit"
        disabled={deleted.isPending}
        aria-label="Delete task"
        data-testid="delete-task-button"
        className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700 transition hover:border-red-300 disabled:opacity-50"
      >
        {deleted.isPending ? "Deleting…" : "Delete task"}
      </button>
      {message ? (
        <span
          role="alert"
          className="mt-1 block text-[10px] font-semibold text-red-600"
        >
          {message}
        </span>
      ) : null}
      <span className="sr-only">{title}</span>
    </form>
  );
}

export function TaskDetail({
  task,
  comments,
  people,
}: {
  task: TaskWithProject;
  comments: Comment[];
  /** Every member, for the comment author select. */
  people: User[];
}) {
  return (
    <div
      data-testid="task-detail"
      className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9"
    >
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="mb-2 text-[11px] font-medium text-slate-500">
            <Link href="/projects" className="hover:text-brand-600">
              Projects
            </Link>{" "}
            / {task.projectName}
          </p>
          <h1
            data-testid="task-title"
            className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]"
          >
            {task.title}
          </h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            Project:{" "}
            <Link
              href={`/projects/${task.projectId}`}
              data-testid="project-link"
              className="font-semibold text-brand-700 hover:underline"
            >
              {task.projectName}
            </Link>
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Link
            href={`/tasks/${task.id}/edit`}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Edit task
          </Link>
          <DeleteTaskButton
            taskId={task.id}
            projectId={task.projectId}
            title={task.title}
          />
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-5">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
            <div className="p-5">
              <h2 className="mb-2 text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Description
              </h2>
              <p
                data-testid="task-description"
                className="text-[13px] leading-7 text-slate-600"
              >
                {task.description}
              </p>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
            <div className="border-b border-slate-100 px-5 py-4">
              {/* The count comes from the rendered list so the heading
                  can never disagree with what is on screen. */}
              <h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Comments{" "}
                <span className="text-slate-500">({comments.length})</span>
              </h2>
            </div>

            {comments.length === 0 ? (
              <p className="px-5 py-6 text-[12px] text-slate-500">
                No comments yet.
              </p>
            ) : (
              <div className="px-5">
                {comments.map((comment) => (
                  <article
                    key={comment.id}
                    data-testid="comment-row"
                    className="border-b border-slate-100 py-4 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="grid h-7 w-7 place-items-center rounded-full bg-indigo-50 text-[9px] font-extrabold text-indigo-600"
                      >
                        {initials(comment.authorName)}
                      </span>
                      <b
                        data-testid="comment-author"
                        className="text-[12px] text-slate-700"
                      >
                        {comment.authorName}
                      </b>
                      <small
                        data-testid="comment-created-at"
                        className="text-[11px] text-slate-500"
                      >
                        {comment.createdAt}
                      </small>
                    </div>
                    <p
                      data-testid="comment-body"
                      className="ml-9 mt-2 text-[12px] leading-6 text-slate-600"
                    >
                      {comment.body}
                    </p>
                  </article>
                ))}
              </div>
            )}

            <AddCommentForm taskId={task.id} people={people} />
          </section>
        </div>

        <aside>
          <section
            aria-label="Task details"
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Task details
              </h2>
            </div>
            <dl className="p-5 text-[12px]">
              <DetailsRow label="Status">
                <span data-testid="task-status">
                  <StatusBadge status={task.status} />
                </span>
              </DetailsRow>
              <DetailsRow label="Project">{task.projectName}</DetailsRow>
              <DetailsRow label="Assigned to">
                <span data-testid="task-assignee">{task.assigneeName}</span>
              </DetailsRow>
              <DetailsRow label="Updated">
                <span
                  data-testid="task-updated-at"
                  className="font-normal text-slate-600"
                >
                  {task.updatedAt}
                </span>
              </DetailsRow>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
