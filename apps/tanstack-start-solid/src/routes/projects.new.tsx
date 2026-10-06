// src/routes/projects.new.tsx — the create-project form.
//
// The Next.js page read nothing: the form submits a server action and the
// action owns the write, so the route only renders the form.

import { createFileRoute } from "@tanstack/solid-router";

import { ProjectForm } from "@/components/projects/project-form";

export const Route = createFileRoute("/projects/new")({
	component: NewProjectPage,
});

function NewProjectPage() {
	return <ProjectForm />;
}
