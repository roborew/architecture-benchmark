import { TaskForm } from "./_components/task-form";
import { getProjects, getUsers } from "@/lib/data";

// The form's Project and Assigned user selects are populated from the database,
// not a fixture: offering a member or project that no longer exists would
// produce a validation error the user cannot resolve from this page.
export default async function NewTaskPage() {
  const [projects, people] = await Promise.all([getProjects(), getUsers()]);

  return <TaskForm projects={projects} people={people} />;
}
