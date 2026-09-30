import { TaskForm } from "./_components/task-form";
import { projects, people } from "@tests/fixtures/data";

export default function NewTaskPage() {
  return <TaskForm projects={projects} people={people} />;
}
