import Link from "next/link";
import {
  cancelClass,
  createClass,
  inputClass,
  labelClass,
  textareaClass,
} from "@/lib/form-styles";

export function ProjectForm() {
  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7">
        <p className="mb-2 text-[11px] font-medium text-slate-500">
          Projects / New project
        </p>
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          New project
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          Create a project before adding its tasks.
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        {/* Not a form element: this version renders static data and
            implements no writes, and a form would submit and reload. */}
        <div className="max-w-2xl p-5">
          <label htmlFor="project-name" className={labelClass}>
            Project name
          </label>
          <input
            id="project-name"
            placeholder="e.g. Website redesign"
            className={`${inputClass} mb-4`}
          />

          <label htmlFor="project-description" className={labelClass}>
            Description
          </label>
          <textarea
            id="project-description"
            placeholder="What is this project for?"
            className={textareaClass}
          />

          <div className="mt-5 flex justify-end gap-2">
            <Link href="/projects" className={cancelClass}>
              Cancel
            </Link>
            <button type="button" className={createClass}>
              Create project
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
