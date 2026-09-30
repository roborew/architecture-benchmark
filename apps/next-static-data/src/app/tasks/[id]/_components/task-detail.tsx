import Link from "next/link";
import type { Comment, TaskWithProject } from "@/types";
import { StatusBadge } from "@/app/_components/status-badge";
import { initials } from "@/lib/initials";

const fieldLabel =
  "text-[10px] font-bold uppercase tracking-[.08em] text-slate-500";

function DetailsRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <dt className={fieldLabel}>{label}</dt>
      <dd className="mt-1 font-semibold text-slate-700">{children}</dd>
    </div>
  );
}

export function TaskDetail({
  task,
  comments,
}: {
  task: TaskWithProject;
  comments: Comment[];
}) {
  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="mb-2 text-[11px] font-medium text-slate-500">
            <Link href="/projects" className="hover:text-brand-600">
              Projects
            </Link>{" "}
            / {task.projectName}
          </p>
          <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            {task.title}
          </h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            Project: {task.projectName}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/tasks/new"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Edit task
          </Link>
          <span className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
            Delete task
          </span>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-5">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
            <div className="p-5">
              <h2 className="mb-2 text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Description
              </h2>
              <p className="text-[13px] leading-7 text-slate-600">
                {task.description}
              </p>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
            <div className="border-b border-slate-100 px-5 py-4">
              {/* The count comes from the rendered list so the heading
                  can never disagree with what is on screen. */}
              <h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Comments <span className="text-slate-500">({comments.length})</span>
              </h2>
            </div>

            {comments.length === 0 ? (
              <p className="px-5 py-6 text-[12px] text-slate-500">
                No comments yet.
              </p>
            ) : (
              <div className="px-5">
                {comments.map((comment) => (
                  <article
                    key={comment.id}
                    className="border-b border-slate-100 py-4 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="grid h-7 w-7 place-items-center rounded-full bg-indigo-50 text-[9px] font-extrabold text-indigo-600"
                      >
                        {initials(comment.authorName)}
                      </span>
                      <b className="text-[12px] text-slate-700">
                        {comment.authorName}
                      </b>
                      <small className="text-[11px] text-slate-500">
                        {comment.createdAt}
                      </small>
                    </div>
                    <p className="ml-9 mt-2 text-[12px] leading-6 text-slate-600">
                      {comment.body}
                    </p>
                  </article>
                ))}
              </div>
            )}

            {/* Static chrome: this version renders seed data and does
                not implement writes. */}
            <form className="border-t border-slate-100 p-5">
              <label
                htmlFor="comment-body"
                className="mb-1.5 block text-[11px] font-bold text-slate-600"
              >
                Add comment
              </label>
              <textarea
                id="comment-body"
                placeholder="Write a comment…"
                className="mb-4 min-h-23 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-[12px] text-slate-700 outline-none placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <label
                  htmlFor="comment-author"
                  className="text-[11px] text-slate-500"
                >
                  Author
                  <select
                    id="comment-author"
                    className="ml-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                  >
                    <option>Robin Andrew</option>
                    <option>Alex Morgan</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
                >
                  Add comment
                </button>
              </div>
            </form>
          </section>
        </div>

        <aside>
          <section
            aria-label="Task details"
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-[15px] font-bold tracking-[-.02em] text-slate-800">
                Task details
              </h2>
            </div>
            <dl className="p-5 text-[12px]">
              <DetailsRow label="Status">
                <StatusBadge status={task.status} />
              </DetailsRow>
              <DetailsRow label="Project">{task.projectName}</DetailsRow>
              <DetailsRow label="Assigned to">{task.assigneeName}</DetailsRow>
              <DetailsRow label="Updated">
                <span className="font-normal text-slate-600">
                  {task.updatedAt}
                </span>
              </DetailsRow>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
