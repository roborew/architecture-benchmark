import { TaskForm } from "./_components/task-form";
import { getQueryClient, orpc } from "@/orpc/server";

// The form's Project and Assigned user selects are populated from the database,
// not a fixture: offering a member or project that no longer exists would
// produce a validation error the user cannot resolve from this page.
export default async function NewTaskPage() {
  const queryClient = getQueryClient();
  const [projects, people] = await Promise.all([
    queryClient.fetchQuery(orpc.projects.list.queryOptions({ input: { search: "" } })),
    queryClient.fetchQuery(orpc.users.list.queryOptions({ input: { search: "" } })),
  ]);

  return <TaskForm projects={projects} people={people} />;
}
