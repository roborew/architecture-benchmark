// The delete control for one project row.

import { useServerFn } from "@tanstack/solid-start";

import { ID_FIELD, deleteProjectFn } from "@/server/mutations";
import { useServerAction, withId } from "@/hooks/use-server-action";

export function DeleteProjectButton(props: {
  projectId: number;
  projectName: string;
}) {
  const bound = useServerFn(deleteProjectFn);
  const [state, formAction, pending] = useServerAction((fd: FormData) =>
    bound({ data: withId(fd, ID_FIELD.project, props.projectId) }),
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
        aria-label={`Delete ${props.projectName}`}
        class="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 underline transition hover:text-red-600 disabled:opacity-50"
      >
        {pending() ? "Deleting…" : "Delete"}
      </button>
      {state().message ? (
        <span
          role="alert"
          class="mt-1 block text-[10px] font-semibold text-red-600"
        >
          {state().message}
        </span>
      ) : null}
    </form>
  );
}
