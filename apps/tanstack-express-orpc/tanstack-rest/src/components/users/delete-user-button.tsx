// src/components/users/delete-user-button.tsx
//
// The delete control for one workspace member.
//
// Shaped like the other delete controls: a form rather than a button, so the
// action works without client state, with the pending flag and an alert region
// added by `useApiAction`. The action's reply matters here —
// `comments.author_id` is ON DELETE RESTRICT, so deleting a member who has
// written anything is refused (a 409 from the API) and the reason has to be
// visible.

import { deleteUser } from "@/api/users";
import { useApiAction } from "@/hooks/use-api-action";
import type { User } from "@/lib/types";

export function DeleteUserButton({ person }: { person: User }) {
	// The row is identified by the closure's id, not by a form field: the API's
	// delete URL carries it.
	const [state, formAction, pending] = useApiAction(() =>
		deleteUser(person.id),
	);

	return (
		<form action={formAction} className="inline">
			<button
				type="submit"
				disabled={pending}
				// The id is in the label as well as the name: `users.display_name` has
				// no UNIQUE constraint, so two members can share a name and two rows
				// would otherwise offer an identically-labelled control.
				aria-label={`Delete ${person.name} (id ${person.id})`}
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
