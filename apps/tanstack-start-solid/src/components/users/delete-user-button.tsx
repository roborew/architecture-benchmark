import { useServerFn } from "@tanstack/solid-start";
import { useServerAction, withId } from "@/hooks/use-server-action";
import type { User } from "@/lib/types";
import { deleteUserFn, ID_FIELD } from "@/server/mutations";

export function DeleteUserButton(props: { person: User }) {
	const bound = useServerFn(deleteUserFn);
	const [state, formAction, pending] = useServerAction((fd: FormData) =>
		bound({ data: withId(fd, ID_FIELD.user, props.person.id) }),
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
				aria-label={`Delete ${props.person.name} (id ${props.person.id})`}
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
