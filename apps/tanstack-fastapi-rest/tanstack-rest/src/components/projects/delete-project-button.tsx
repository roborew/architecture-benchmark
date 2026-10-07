// src/components/projects/delete-project-button.tsx
//
// The delete control for one project row.
//
// It is a form rather than a button so the action works without JavaScript:
// React submits it and the row disappears on the re-render. The API returns
// the message shown in the alert region when the FK blocks the delete —
// deleting a project is out of contract (`tasks.project_id` is ON DELETE
// RESTRICT), so a refusal is an expected reply, not an error.

import { deleteProject } from "@/api/projects";
import { useApiAction } from "@/hooks/use-api-action";

export function DeleteProjectButton({
	projectId,
	projectName,
}: {
	projectId: number;
	projectName: string;
}) {
	// The row carries no fields of its own, so the submitted FormData is empty
	// apart from the React synthetic submit entry; the bound id rides the
	// closure into the mutation's URL.
	const [state, formAction, pending] = useApiAction(() =>
		deleteProject(projectId),
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
