"use client";

// One form for both creating and editing a project. The only difference
// between the two is which mutation runs and whether the fields start populated,
// so `project` is the single switch.
//
// A Client Component because the mutation is an imperative call. This replaced a
// `useActionState` form, so two things changed shape:
//
//   1. There is no <form action={...}> any more — a mutation is a function call,
//      so the form submits through onSubmit and needs JS to submit at all.
//   2. There is no action-supplied state, so the { errors, message } the action
//      used to return is held in `state` below. The JSX that renders it is
//      unchanged, which is the point: tRPC's error contract is the same shape.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Project } from "@/lib/types";
import type { ActionResult, FieldErrors } from "@/trpc/result";
import { useTRPC } from "@/trpc/client";
import {
  cancelClass,
  createClass,
  inputClass,
  labelClass,
  textareaClass,
} from "@/lib/form-styles";

type FormState = { errors?: FieldErrors; message?: string | null };

export function ProjectForm({ project }: { project?: Project }) {
  const isEdit = project !== undefined;

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();

  // The mutation's reply, held locally — the stand-in for what `useActionState`
  // used to hand this component.
  const [state, setState] = useState<FormState>({});

  // Controlled rather than `defaultValue`, so a rejected submit leaves the typed
  // values in place — exactly the moment the user most needs to see what went
  // wrong.
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");

  // `mutationOptions()` builds the options object; TanStack's useMutation runs
  // it. The proxy has no `.useMutation()` — that was the old @trpc/react-query
  // API. Both are constructed unconditionally so the hook order is stable.
  const created = useMutation(trpc.projects.create.mutationOptions());
  const updated = useMutation(trpc.projects.update.mutationOptions());
  const pending = isEdit ? updated.isPending : created.isPending;

  /**
   * Shared by both mutations. A refused mutation is expected user error, not an
   * exception, so it renders instead of throwing — the procedure returns
   * { ok: false } and the form shows the field message.
   *
   * On success the Server Action used to call revalidatePath("/") and
   * revalidatePath("/projects") before redirecting. Those become query
   * invalidations, and the redirect becomes router.push.
   */
  async function settle(result: ActionResult, destination: string) {
    if (!result.ok) {
      setState({ errors: result.errors, message: result.message });
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries(trpc.projects.list.queryFilter()),
      queryClient.invalidateQueries(trpc.projects.byId.queryFilter()),
    ]);

    router.push(destination);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({});

    if (isEdit && project) {
      updated.mutate(
        { id: project.id, name, description },
        { onSuccess: (result) => settle(result, "/projects") },
      );
      return;
    }

    created.mutate(
      { name, description },
      { onSuccess: (result) => settle(result, "/projects") },
    );
  }

  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7">
        <p className="mb-2 text-[11px] font-medium text-slate-500">
          Projects / {isEdit ? project.name : "New project"}
        </p>
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          {isEdit ? "Edit project" : "New project"}
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          {isEdit
            ? "Update the name and description of this project."
            : "Create a project before adding its tasks."}
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        <form onSubmit={handleSubmit} className="max-w-2xl p-5">
          {state.message ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] font-semibold text-red-700"
            >
              {state.message}
            </p>
          ) : null}

          <label htmlFor="project-name" className={labelClass}>
            Project name
          </label>
          <input
            id="project-name"
            name="name"
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Website redesign"
            aria-invalid={state.errors?.name ? true : undefined}
            aria-describedby={
              state.errors?.name ? "project-name-error" : undefined
            }
            className={`${inputClass} mb-1`}
          />
          {state.errors?.name ? (
            <p
              id="project-name-error"
              className="mb-3 text-[11px] font-semibold text-red-600"
            >
              {state.errors.name[0]}
            </p>
          ) : (
            <div className="mb-3" />
          )}

          <label htmlFor="project-description" className={labelClass}>
            Description
          </label>
          <textarea
            id="project-description"
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this project for?"
            className={`${textareaClass} mt-1.5 mb-0`}
          />

          <div className="mt-5 flex items-center justify-end gap-2">
            <Link href="/projects" className={cancelClass}>
              Cancel
            </Link>
            <button type="submit" disabled={pending} className={createClass}>
              {pending
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isEdit
                  ? "Save changes"
                  : "Create project"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
