"use client";

// One form for both creating and editing a project. The only difference
// between the two is which action runs and whether the fields start populated,
// so `project` is the single switch.
//
// It is a Client Component because `useActionState` supplies the validation
// state and the pending flag. The action itself still runs on the server.

import Link from "next/link";
import { useActionState } from "react";

import type { Project } from "@/lib/types";
import { createProject, updateProject, type State } from "@/lib/actions";
import {
  cancelClass,
  createClass,
  inputClass,
  labelClass,
  textareaClass,
} from "@/lib/form-styles";

const initialState: State = {};

export function ProjectForm({ project }: { project?: Project }) {
  const isEdit = project !== undefined;

  // `updateProject` takes the id first; binding it leaves the
  // (previousState, formData) signature `useActionState` expects.
  const action = isEdit ? updateProject.bind(null, project.id) : createProject;

  const [state, formAction, pending] = useActionState(action, initialState);

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
        <form action={formAction} className="max-w-2xl p-5">
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
            defaultValue={project?.name ?? ""}
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
            defaultValue={project?.description ?? ""}
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
