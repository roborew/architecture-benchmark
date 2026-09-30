import Link from "next/link";
import {
  cancelClass,
  createClass,
  inputClass,
  labelClass,
} from "@/lib/form-styles";

export function UserForm() {
  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7">
        <p className="mb-2 text-[11px] font-medium text-slate-500">
          People / New user
        </p>
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          New user
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          Add a workspace member before assigning them tasks.
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        {/* Not a form element: this version renders static data and
            implements no writes, and a form would submit and reload. */}
        <div className="max-w-2xl p-5">
          <label htmlFor="user-name" className={labelClass}>
            Name
          </label>
          <input
            id="user-name"
            placeholder="e.g. Alex Morgan"
            className={`${inputClass} mb-4`}
          />

          <label htmlFor="user-email" className={labelClass}>
            Email
          </label>
          <input
            id="user-email"
            type="email"
            placeholder="alex@example.test"
            className={`${inputClass} mb-4`}
          />

          <div className="mt-5 flex justify-end gap-2">
            <Link href="/users" className={cancelClass}>
              Cancel
            </Link>
            <button type="button" className={createClass}>
              Create user
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
