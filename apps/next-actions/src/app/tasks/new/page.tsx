import { TaskForm } from "./_components/task-form";
import { projects, people } from "@/test/data";

export default function NewTaskPage() {
  return <TaskForm projects={projects} people={people} />;
}
