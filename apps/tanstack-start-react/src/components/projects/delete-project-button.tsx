// The delete control for one project row.
//
// It is a form rather than a button so the action works without JavaScript:
// React submits it and the row disappears on the re-render. The action returns
// the message shown in the alert region when the FK blocks the delete.

import { useServerFn } from "@tanstack/react-start";

import { ID_FIELD, deleteProjectFn } from "@/server/mutations";
import { useServerAction, withId } from "@/hooks/use-server-action";

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const bound = useServerFn(deleteProjectFn);
  // The row carries no fields of its own, so the submitted FormData only
  // receives the bound project id.
  const [state, formAction, pending] = useServerAction((fd: FormData) =>
    bound({ data: withId(fd, ID_FIELD.project, projectId) }),
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
