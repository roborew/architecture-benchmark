// src/routes/users.new.tsx — the create-user form.
//
// Nothing here reads the API: the form submits a mutation through
// `useApiAction` and the action owns the write, so the route only renders the
// form. On success the API's `redirectTo` sends the browser to the new
// member's own page.

import { createFileRoute } from "@tanstack/react-router";

import { UserForm } from "@/components/users/user-form";

export const Route = createFileRoute("/users/new")({
	component: NewUserPage,
});

function NewUserPage() {
	return <UserForm />;
}
