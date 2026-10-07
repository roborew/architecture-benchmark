// src/routes/projects.new.tsx — the create-project form.
//
// Nothing here reads the API: the form submits a mutation through
// `useApiAction` and the action owns the write, so the route only renders the
// form. On success the API's `redirectTo` sends the browser to the new
// project's board.

import { createFileRoute } from "@tanstack/react-router";

import { ProjectForm } from "@/components/projects/project-form";

export const Route = createFileRoute("/projects/new")({
	component: NewProjectPage,
});

function NewProjectPage() {
	return <ProjectForm />;
}
