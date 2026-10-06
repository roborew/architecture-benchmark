// src/routes/tasks.new.tsx — the create-task form.
//
// The form's Project and Assigned user selects are populated from the database,
// not a fixture: offering a member or project that no longer exists would
// produce a validation error the user cannot resolve from this page.

import { createFileRoute } from "@tanstack/react-router";

import { TaskForm } from "@/components/tasks/task-form";
import { fetchTaskFormOptions } from "@/server/queries";

export const Route = createFileRoute("/tasks/new")({
  loader: () => fetchTaskFormOptions(),
  component: NewTaskPage,
});

function NewTaskPage() {
  const { projects, people } = Route.useLoaderData();

  return <TaskForm projects={projects} people={people} />;
}
