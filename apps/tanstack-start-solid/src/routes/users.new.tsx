// src/routes/users.new.tsx — the create form.
//
// The Next.js page was a one-line Server Component that rendered the shared
// form. Nothing here reads the database, so there is no loader: `UserForm`
// carries the whole page, and the create server function is bound inside it.

import { createFileRoute } from "@tanstack/solid-router";

import { UserForm } from "@/components/users/user-form";

export const Route = createFileRoute("/users/new")({
	component: NewUserPage,
});

function NewUserPage() {
	return <UserForm />;
}
