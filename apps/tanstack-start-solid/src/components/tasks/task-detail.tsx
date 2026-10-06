import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal, Show, For } from "solid-js";
import type { ParentComponent } from "solid-js";

import type { Comment, TaskWithProject, User } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";
import { ID_FIELD, createCommentFn, deleteTaskFn } from "@/server/mutations";
import { initials } from "@/lib/initials";
import { useServerAction, withId } from "@/hooks/use-server-action";

const fieldLabel =
  "text-[10px] font-bold uppercase tracking-[.08em] text-slate-500";

function DetailsRow(props: {
  label: string;
  children: ParentComponent["children"];
}) {
  return (
    <div class="mb-4 last:mb-0">
      <dt class={fieldLabel}>{props.label}</dt>
      <dd class="mt-1 font-semibold text-slate-700">{props.children}</dd>
    </div>
  );
}

function AddCommentForm(props: { taskId: number; people: User[] }) {
  const bound = useServerFn(createCommentFn);
  const [state, formAction, pending] = useServerAction((fd: FormData) =>
    bound({ data: withId(fd, ID_FIELD.task, props.taskId) }),
  );

  const [body, setBody] = createSignal("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        formAction(new FormData(e.currentTarget));
      }}
      class="border-t border-slate-100 p-5"
    >
      <Show when={state().message}>
        <p
          role="alert"
          class="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] font-semibold text-red-700"
        >
          {state().message}
        </p>
      </Show>

      <label
        for="comment-body"
        class="mb-1.5 block text-[11px] font-bold text-slate-600"
      >
        Add comment
      </label>
      <textarea
        id="comment-body"
        name="commentBody"
        value={body()}
        onInput={(event) => setBody(event.currentTarget.value)}
        aria-invalid={state().errors?.commentBody ? true : undefined}
        aria-describedby={
          state().errors?.commentBody ? "comment-body-error" : undefined
        }
        placeholder="Write a comment…"
        class="mb-4 min-h-23 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-[12px] text-slate-700 outline-none placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
      <Show when={state().errors?.commentBody}>
        <p
          id="comment-body-error"
          class="-mt-2 mb-3 text-[11px] font-semibold text-red-600"
        >
          {state().errors!.commentBody[0]}
        </p>
      </Show>

      <div class="mt-3 flex items-center justify-between gap-3">
        <label for="comment-author" class="text-[11px] text-slate-500">
          Author
          <select
            id="comment-author"
            name="commentAuthorId"
            class="ml-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
          >
            <For each={props.people}>
              {(person) => <option value={person.id}>{person.name}</option>}
            </For>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending()}
          class="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700 disabled:opacity-50"
        >
          {pending() ? "Adding…" : "Add comment"}
        </button>
      </div>
    </form>
  );
}

function DeleteTaskButton(props: { taskId: number; title: string }) {
  const bound = useServerFn(deleteTaskFn);
  const [state, formAction, pending] = useServerAction((fd: FormData) =>
    bound({ data: withId(fd, ID_FIELD.task, props.taskId) }),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        formAction(new FormData(e.currentTarget));
      }}
      class="inline"
    >
      <button
        type="submit"
        disabled={pending()}
        aria-label="Delete task"
        class="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700 transition hover:border-red-300 disabled:opacity-50"
      >
        {pending() ? "Deleting…" : "Delete task"}
      </button>
      <Show when={state().message}>
        <span
          role="alert"
          class="mt-1 block text-[10px] font-semibold text-red-600"
        >
          {state().message}
        </span>
      </Show>
      <span class="sr-only">{props.title}</span>
    </form>
  );
}

export function TaskDetail(props: {
  task: TaskWithProject;
  comments: Comment[];
  people: User[];
}) {
  return (
    <div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p class="mb-2 text-[11px] font-medium text-slate-500">
            <Link to="/projects" class="hover:text-brand-600">
              Projects
            </Link>{" "}
            / {props.task.projectName}
          </p>
          <h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            {props.task.title}
          </h1>
          <p class="mt-1.5 text-[13px] leading-6 text-slate-500">
            Project: {props.task.projectName}
          </p>
        </div>
        <div class="flex items-start gap-2">
          <Link
            to="/tasks/$id/edit"
            params={{ id: String(props.task.id) }}
            class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Edit task
          </Link>
          <DeleteTaskButton taskId={props.task.id} title={props.task.title} />
        </div>
      </div>

      <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div class="grid gap-5">
          <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
            <div class="p-5">
              <h2 class="mb-2 text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Description
              </h2>
              <p class="text-[13px] leading-7 text-slate-600">
                {props.task.description}
              </p>
            </div>
          </section>

          <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
            <div class="border-b border-slate-100 px-5 py-4">
              <h2 class="text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Comments{" "}
                <span class="text-slate-500">({props.comments.length})</span>
              </h2>
            </div>

            <Show
              when={props.comments.length > 0}
              fallback={
                <p class="px-5 py-6 text-[12px] text-slate-500">
                  No comments yet.
                </p>
              }
            >
              <div class="px-5">
                <For each={props.comments}>
                  {(comment) => (
                    <article class="border-b border-slate-100 py-4 last:border-0">
                      <div class="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          class="grid h-7 w-7 place-items-center rounded-full bg-indigo-50 text-[9px] font-extrabold text-indigo-600"
                        >
                          {initials(comment.authorName)}
                        </span>
                        <b class="text-[12px] text-slate-700">
                          {comment.authorName}
                        </b>
                        <small class="text-[11px] text-slate-500">
                          {comment.createdAt}
                        </small>
                      </div>
                      <p class="ml-9 mt-2 text-[12px] leading-6 text-slate-600">
                        {comment.body}
                      </p>
                    </article>
                  )}
                </For>
              </div>
            </Show>

            <AddCommentForm taskId={props.task.id} people={props.people} />
          </section>
        </div>

        <aside>
          <section
            aria-label="Task details"
            class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel"
          >
            <div class="border-b border-slate-100 px-5 py-4">
              <h2 class="text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Task details
              </h2>
            </div>
            <dl class="p-5 text-[12px]">
              <DetailsRow label="Status">
                <StatusBadge status={props.task.status} />
              </DetailsRow>
              <DetailsRow label="Project">{props.task.projectName}</DetailsRow>
              <DetailsRow label="Assigned to">
                {props.task.assigneeName}
              </DetailsRow>
              <DetailsRow label="Updated">
                <span class="font-normal text-slate-600">
                  {props.task.updatedAt}
                </span>
              </DetailsRow>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
