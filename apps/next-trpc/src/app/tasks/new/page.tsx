import { TaskForm } from "./_components/task-form";
import { getQueryClient, trpc } from "@/trpc/server";

// The form's Project and Assigned user selects are populated from the database,
// not a fixture: offering a member or project that no longer exists would
// produce a validation error the user cannot resolve from this page.
export default async function NewTaskPage() {
  const queryClient = getQueryClient();
  const [projects, people] = await Promise.all([
    queryClient.fetchQuery(trpc.projects.list.queryOptions({ search: "" })),
    queryClient.fetchQuery(trpc.users.list.queryOptions({ search: "" })),
  ]);

  return <TaskForm projects={projects} people={people} />;
}
