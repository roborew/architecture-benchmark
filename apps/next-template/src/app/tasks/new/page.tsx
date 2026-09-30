import { TaskForm } from "./_components/task-form";
import { projects, people } from "@/lib/data";

export default function NewTaskPage() {
  return <TaskForm projects={projects} people={people} />;
}
