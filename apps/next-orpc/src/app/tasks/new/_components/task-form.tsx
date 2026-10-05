"use client";

// One form for creating a task and for editing an existing one, plus a second
// form for the create-with-comment path.
//
// The two create forms exist separately because only the comment form is atomic
// (spec/queries.md: one transaction, task and comment or neither). Merging them
// would make every plain create pay for a comment field the user did not fill in.
//
// A Client Component because the mutations are imperative calls. This replaced
// `useActionState` forms, so two things changed shape:
//
//   1. There is no <form action={...}> any more — a mutation is a function call,
//      so the forms submit through onSubmit and need JS to submit at all.
//   2. There is no action-supplied state, so the { errors, message } the actions
//      used to return is held in `state` below. The JSX that renders it is
//      unchanged, which is the point: tRPC's error contract is the same shape.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Project, Task, User } from "@/lib/types";
import type { ActionResult, FieldErrors } from "@/trpc/result";
import { useTRPC } from "@/trpc/client";
import {
  cancelClass,
  createClass,
  inputClass,
  labelClass,
  selectClass,
  textareaClass,
} from "@/lib/form-styles";

type FormState = { errors?: FieldErrors; message?: string | null };

const STATUSES: { value: Task["status"]; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in progress", label: "In progress" },
  { value: "done", label: "Done" },
];

/**
 * Shared select fields.
 *
 * `idPrefix` keeps the `id`/`htmlFor` pairs unique: both forms render a Project
 * and an Assigned user select, and a duplicate `id` would make the label bind to
 * whichever came first in the document — leaving the second control unnamed.
 */
function ProjectSelect({
  projects,
  defaultValue,
  invalid,
  idPrefix,
}: {
  projects: Project[];
  defaultValue: number;
  invalid?: boolean;
  idPrefix: string;
}) {
  return (
    <div>
      <label htmlFor={`${idPrefix}-project`} className={labelClass}>
        Project
      </label>
      <select
        id={`${idPrefix}-project`}
        name="projectId"
        defaultValue={String(defaultValue)}
        aria-invalid={invalid ? true : undefined}
        className={selectClass}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function AssigneeSelect({
  people,
  defaultValue,
  invalid,
  idPrefix,
}: {
  people: User[];
  defaultValue: number | null;
  invalid?: boolean;
  idPrefix: string;
}) {
  return (
    <div>
      <label htmlFor={`${idPrefix}-assignee`} className={labelClass}>
        Assigned user
      </label>
      <select
        id={`${idPrefix}-assignee`}
        name="assigneeId"
        // An empty value is the explicit "unassigned" choice spec/contract.md
        // requires; it is never inferred from a missing field.
        defaultValue={defaultValue === null ? "" : String(defaultValue)}
        aria-invalid={invalid ? true : undefined}
        className={selectClass}
      >
        <option value="">Unassigned</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatusSelect({
  defaultValue,
  invalid,
  idPrefix,
}: {
  defaultValue: Task["status"];
  invalid?: boolean;
  idPrefix: string;
}) {
  return (
    <div>
      <label htmlFor={`${idPrefix}-status`} className={labelClass}>
        Status
      </label>
      <select
        id={`${idPrefix}-status`}
        name="status"
        defaultValue={defaultValue}
        aria-invalid={invalid ? true : undefined}
        className={selectClass}
      >
        {STATUSES.map((status) => (
          <option key={status.value} value={status.value}>
            {status.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FormMessage({ message }: { message?: string | null }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] font-semibold text-red-700"
    >
      {message}
    </p>
  );
}

/** The panel chrome both forms share, so only the fields differ between them. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
      <div className="max-w-3xl p-5">{children}</div>
    </section>
  );
}

export function TaskForm({
  projects,
  people,
  task,
}: {
  projects: Project[];
  people: User[];
  task?: Task;
}) {
  const isEdit = task !== undefined;

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [state, setState] = useState<FormState>({});

  // Controlled rather than `defaultValue`: a rejected submit must not blank the
  // fields the user just typed — precisely when they most need to see what went
  // wrong.
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");

  // `mutationOptions()` builds the options object; TanStack's useMutation runs it.
  // The proxy has no `.useMutation()` — that was the old @trpc/react-query API.
  // Both are constructed unconditionally so the hook order is stable.
  const created = useMutation(trpc.tasks.create.mutationOptions());
  const updated = useMutation(trpc.tasks.update.mutationOptions());
  const pending = isEdit ? updated.isPending : created.isPending;

  /**
   * Shared by both mutations. A refused mutation is expected user error, not an
   * exception, so it renders instead of throwing — the procedure returns
   * { ok: false } and the form shows the field message.
   *
   * On success the Server Actions used to call revalidatePath on the task list,
   * this task's detail page and its project board before redirecting. Those become
   * query invalidations, and the redirect becomes router.push.
   */
  async function settle(result: ActionResult, destination: string) {
    if (!result.ok) {
      setState({ errors: result.errors, message: result.message });
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries(trpc.tasks.list.queryFilter()),
      queryClient.invalidateQueries(trpc.tasks.count.queryFilter()),
      queryClient.invalidateQueries(trpc.tasks.byId.queryFilter()),
    ]);

    router.push(destination);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({});

    const fields = new FormData(event.currentTarget);
    // `assigneeId` is `number | null`, never undefined: spec/contract.md gives
    // exactly one way to unassign, and that is an explicit empty choice.
    const assigneeId = Number(fields.get("assigneeId")) || null;

    if (isEdit && task) {
      updated.mutate(
        {
          id: task.id,
          title,
          description,
          status: fields.get("status") as string,
          assigneeId,
        },
        { onSuccess: (result) => settle(result, `/tasks/${task.id}`) },
      );
      return;
    }

    created.mutate(
      {
        title,
        description,
        status: fields.get("status") as string,
        projectId: Number(fields.get("projectId")),
        assigneeId,
      },
      { onSuccess: (result) => settle(result, "/tasks") },
    );
  }

  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7">
        <p className="mb-2 text-[11px] font-medium text-slate-500">
          Tasks / {isEdit ? task.title : "New task"}
        </p>
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          {isEdit ? "Edit task" : "New task"}
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          {isEdit
            ? "Update this task. Clearing the assignee leaves it unassigned."
            : "Select the project and user that this task belongs to."}
        </p>
      </div>

      <div className="grid gap-5">
        <Panel>
          <form onSubmit={handleSubmit} data-testid="create-task-form">
            <FormMessage message={state.message} />

            <label htmlFor="task-title" className={labelClass}>
              Title
            </label>
            <input
              id="task-title"
              name="title"
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs to be done?"
              aria-invalid={state.errors?.title ? true : undefined}
              aria-describedby={
                state.errors?.title ? "task-title-error" : undefined
              }
              className={`${inputClass} mb-1`}
            />
            {state.errors?.title ? (
              <p
                id="task-title-error"
                className="mb-3 text-[11px] font-semibold text-red-600"
              >
                {state.errors.title[0]}
              </p>
            ) : (
              <div className="mb-3" />
            )}

            <label htmlFor="task-description" className={labelClass}>
              Description
            </label>
            <textarea
              id="task-description"
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add context (optional)"
              className={`${textareaClass} mt-1.5 mb-0`}
            />

            <div className="grid gap-4 sm:grid-cols-3">
              {/* On an edit the project is fixed: spec/contract.md lists the
                  update form's fields as title, status, assignee and
                  description only. */}
              {isEdit ? (
                <div>
                  <span className={labelClass}>Project</span>
                  <p className="text-[12px] text-slate-700">
                    {projects.find((p) => p.id === task.projectId)?.name ??
                      `Project ${task.projectId}`}
                  </p>
                </div>
              ) : (
                // No `task?.projectId` here: this branch only renders when there
                // is no task, so the optional chain would narrow to `never`.
                <ProjectSelect
                  projects={projects}
                  defaultValue={projects[0]?.id ?? 0}
                  invalid={Boolean(state.errors?.projectId)}
                  idPrefix="task"
                />
              )}

              <AssigneeSelect
                people={people}
                defaultValue={task?.assigneeId ?? null}
                invalid={Boolean(state.errors?.assigneeId)}
                idPrefix="task"
              />

              <StatusSelect
                defaultValue={task?.status ?? "todo"}
                invalid={Boolean(state.errors?.status)}
                idPrefix="task"
              />
            </div>

            {state.errors?.assigneeId ? (
              <p className="mt-2 text-[11px] font-semibold text-red-600">
                {state.errors.assigneeId[0]}
              </p>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <Link
                href={isEdit ? `/tasks/${task.id}` : "/tasks"}
                className={cancelClass}
              >
                Cancel
              </Link>
              <button type="submit" disabled={pending} className={createClass}>
                {pending
                  ? isEdit
                    ? "Saving…"
                    : "Creating…"
                  : isEdit
                    ? "Save changes"
                    : "Create task"}
              </button>
            </div>
          </form>
        </Panel>

        {/* Create-with-comment is a create-only path: it is the one spec/queries.md
            requires to be atomic, and an edit has no comment to create. */}
        {!isEdit ? (
          <CreateWithCommentForm projects={projects} people={people} />
        ) : null}
      </div>
    </div>
  );
}

function CreateWithCommentForm({
  projects,
  people,
}: {
  projects: Project[];
  people: User[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [state, setState] = useState<FormState>({});

  const created = useMutation(trpc.tasks.createWithComment.mutationOptions());

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({});

    const fields = new FormData(event.currentTarget);

    created.mutate(
      {
        title: fields.get("title") as string,
        description: "",
        status: fields.get("status") as string,
        projectId: Number(fields.get("projectId")),
        assigneeId: Number(fields.get("assigneeId")) || null,
        commentBody: fields.get("commentBody") as string,
        commentAuthorId: Number(fields.get("commentAuthorId")),
      },
      {
        onSuccess: async (result: ActionResult) => {
          if (!result.ok) {
            setState({ errors: result.errors, message: result.message });
            return;
          }

          await Promise.all([
            queryClient.invalidateQueries(trpc.tasks.list.queryFilter()),
            queryClient.invalidateQueries(trpc.tasks.count.queryFilter()),
          ]);

          router.push("/tasks");
        },
      },
    );
  }

  return (
    <Panel>
      <form onSubmit={handleSubmit} data-testid="create-with-comment-form">
        <h2 className="mb-1 text-[15px] font-bold tracking-[-.02em] text-slate-800">
          New task with a first comment
        </h2>
        <p className="mb-4 text-[12px] leading-6 text-slate-500">
          The task and its opening comment are written together, so either both
          exist or neither does.
        </p>

        <FormMessage message={state.message} />

        <label htmlFor="cwc-title" className={labelClass}>
          Title
        </label>
        <input
          id="cwc-title"
          name="title"
          required
          maxLength={200}
          aria-invalid={state.errors?.title ? true : undefined}
          placeholder="What needs to be done?"
          className={`${inputClass} mb-4`}
        />
        {state.errors?.title ? (
          <p className="-mt-2 mb-3 text-[11px] font-semibold text-red-600">
            {state.errors.title[0]}
          </p>
        ) : null}

        <label htmlFor="cwc-comment" className={labelClass}>
          First comment
        </label>
        <textarea
          id="cwc-comment"
          name="commentBody"
          required
          aria-invalid={state.errors?.commentBody ? true : undefined}
          placeholder="Add a note for the team"
          className={`${textareaClass} mt-1.5 mb-4`}
        />
        {state.errors?.commentBody ? (
          <p className="-mt-2 mb-3 text-[11px] font-semibold text-red-600">
            {state.errors.commentBody[0]}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <ProjectSelect
            projects={projects}
            defaultValue={projects[0]?.id ?? 0}
            invalid={Boolean(state.errors?.projectId)}
            idPrefix="cwc"
          />

          <AssigneeSelect people={people} defaultValue={null} idPrefix="cwc" />

          <div>
            <label htmlFor="cwc-author" className={labelClass}>
              Comment author
            </label>
            <select
              id="cwc-author"
              name="commentAuthorId"
              className={selectClass}
              defaultValue={people[0]?.id ?? ""}
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* spec/contract.md gives this form "the create-task fields plus
            commentBody and commentAuthor". The status select was missing, so the
            form submitted `status: null` and every submit was refused by the enum
            — the atomic path could not be exercised at all from the browser. */}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <StatusSelect
            defaultValue="todo"
            invalid={Boolean(state.errors?.status)}
            idPrefix="cwc"
          />
        </div>

        {state.errors?.status ? (
          <p className="mt-2 text-[11px] font-semibold text-red-600">
            {state.errors.status[0]}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Link href="/tasks" className={cancelClass}>
            Cancel
          </Link>
          <button
            type="submit"
            disabled={created.isPending}
            className={createClass}
          >
            {created.isPending ? "Creating…" : "Create with comment"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
