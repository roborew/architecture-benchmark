import Link from "next/link";
import type { Project, User } from "@/lib/types";
import {
  cancelClass,
  createClass,
  inputClass,
  labelClass,
  selectClass,
  textareaClass,
} from "@/lib/form-styles";

export function TaskForm({
  projects,
  people,
}: {
  projects: Project[];
  people: User[];
}) {
  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7">
        <p className="mb-2 text-[11px] font-medium text-slate-500">
          Tasks / New task
        </p>
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          New task
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          Select the project and user that this task belongs to.
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        {/* Not a form element: this version renders static data and
            implements no writes, and a form would submit and reload. */}
        <div className="max-w-3xl p-5">
          <label htmlFor="task-title" className={labelClass}>
            Title
          </label>
          <input
            id="task-title"
            placeholder="What needs to be done?"
            className={`${inputClass} mb-4`}
          />

          <label htmlFor="task-description" className={labelClass}>
            Description
          </label>
          <textarea
            id="task-description"
            placeholder="Add context (optional)"
            className={textareaClass}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="task-project" className={labelClass}>
                Project
              </label>
              <select id="task-project" className={selectClass} defaultValue="">
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="task-user" className={labelClass}>
                Assigned user
              </label>
              <select id="task-user" className={selectClass} defaultValue="">
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="task-status" className={labelClass}>
                Status
              </label>
              <select id="task-status" className={selectClass} defaultValue="">
                <option value="todo">To do</option>
                <option value="in-progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Link href="/tasks" className={cancelClass}>
              Cancel
            </Link>
            <button type="button" className={createClass}>
              Create task
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
