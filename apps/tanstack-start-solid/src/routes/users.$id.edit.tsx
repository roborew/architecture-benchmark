// src/routes/users.$id.edit.tsx — the edit form.
//
// `notFound()` in Next.js became `throw notFound()` here. Throwing rather than
// returning matters: it unwinds the loader, so nothing renders on a bad id.

import { createFileRoute, notFound } from "@tanstack/solid-router";

import { UserForm } from "@/components/users/user-form";
import { fetchUser } from "@/server/queries";

export const Route = createFileRoute("/users/$id/edit")({
	loader: async ({ params }) => {
		const personId = Number(params.id);

		// `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
		// row, so both paths land on the not-found page.
		const person = Number.isInteger(personId)
			? await fetchUser({ data: { id: personId } })
			: null;

		if (!person) {
			throw notFound();
		}

		return person;
	},
	component: EditUserPage,
});

function EditUserPage() {
	const person = Route.useLoaderData();

	return <UserForm person={person()} />;
}
