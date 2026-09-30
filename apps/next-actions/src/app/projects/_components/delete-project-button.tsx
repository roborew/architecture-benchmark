"use client";

// The delete control for one project row.
//
// It is a form rather than a button so the action works without JavaScript:
// React submits it and the row disappears on the re-render. The Client
// wrapper adds the pending state and an alert region for the error the action
// returns when the FK blocks the delete.

import { useActionState } from "react";

import { deleteProject, type State } from "@/lib/actions";

const initialState: State = {};

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(
    deleteProject.bind(null, projectId),
    initialState,
  );

  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        // The accessible name names the project, so a screen-reader user
        // moving through the list hears which row this deletes.
        aria-label={`Delete ${projectName}`}
        className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 underline transition hover:text-red-600 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {state.message ? (
        <span
          role="alert"
          className="mt-1 block text-[10px] font-semibold text-red-600"
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
