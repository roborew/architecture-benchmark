import Link from "next/link";
import { Suspense } from "react";

import { TaskFilters } from "./_components/task-filters";
import { TaskTable } from "./_components/task-table";
import {
  DEFAULT_PAGE_SIZE,
  formatRange,
  pageRange,
  parsePage,
  parsePageSize,
} from "@/lib/pagination";
import { TaskPagination } from "./_components/task-pagination";
import { getQueryClient, trpc } from "@/trpc/server";

// The workspace-wide task list. Every filter is applied in the query rather
// than in memory: the page used to slice an in-memory fixture, so a task
// created through a server action never appeared here at all.

/**
 * The status filter's query-string spelling.
 *
 * A raw space is awkward in a query string while the stored value is
 * "in progress" (spec/contract.md), so the two are translated here and the
 * query layer only ever sees the stored form.
 */
const STATUS_FROM_QUERY: Record<string, string> = {
  todo: "todo",
  "in-progress": "in progress",
  done: "done",
};

type Query = {
  q?: string | string[];
  project?: string | string[];
  status?: string | string[];
  assignee?: string | string[];
  cursor?: string | string[];
  page?: string | string[];
  size?: string | string[];
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** A select value is a positive integer id, or nothing when unset. */
function toOptionalId(value: string | string[] | undefined) {
  const raw = first(value);
  if (!raw) return undefined;

  const id = Number(raw);

  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const params = await searchParams;

  const search = first(params.q) ?? "";
  const statusParam = first(params.status) ?? "";
  const projectId = toOptionalId(params.project);
  const assigneeId = toOptionalId(params.assignee);
  const cursor = first(params.cursor) ?? null;
  const onLaterPage = cursor !== null;

  // The page size is a query LIMIT, so only the offered values are accepted.
  const size = parsePageSize(first(params.size));

  // The cursor does the paging; the page number is display state alongside it,
  // because a keyset walk carries no offset to derive a position from.
  const page = parsePage(first(params.page), { hasCursor: onLaterPage });

  const filters = {
    search,
    status:
      statusParam in STATUS_FROM_QUERY ? STATUS_FROM_QUERY[statusParam] : "",
    projectId,
    assigneeId,
  };

  const filtered =
    Boolean(search) ||
    Boolean(statusParam) ||
    projectId !== undefined ||
    assigneeId !== undefined;

  // Four independent reads, run concurrently. The count backs the summary line
  // the e2e suite asserts, and is a separate aggregate on purpose: a window
  // COUNT would force Postgres to materialise every matching row.
  const queryClient = getQueryClient();
  const [tasks, total, projects, people] = await Promise.all([
    queryClient.fetchQuery(
      trpc.tasks.list.queryOptions({ ...filters, limit: size + 1, cursor }),
    ),
    queryClient.fetchQuery(trpc.tasks.count.queryOptions(filters)),
    queryClient.fetchQuery(trpc.projects.list.queryOptions({ search: "" })),
    queryClient.fetchQuery(trpc.users.list.queryOptions({ search: "" })),
  ]);

  // Over-fetched by one so `hasMore` costs no COUNT beyond the one already
  // backing the summary line.
  const hasMore = tasks.length > size;
  const rows = tasks.slice(0, size);
  const lastCursor = rows.at(-1)?.cursorFor;

  const range = pageRange({ page, size, total });

  // Keyset paging only moves forward from a cursor, so "Previous" re-runs the
  // first page rather than walking backwards through cursors it no longer has.
  const carriedParams = new URLSearchParams({
    ...(search ? { q: search } : {}),
    ...(statusParam ? { status: statusParam } : {}),
    ...(projectId === undefined ? {} : { project: String(projectId) }),
    ...(assigneeId === undefined ? {} : { assignee: String(assigneeId) }),
    ...(size === DEFAULT_PAGE_SIZE ? {} : { size: String(size) }),
  });
  const prefix = carriedParams.toString();
  const nextHref = lastCursor
    ? `/tasks?${prefix ? `${prefix}&` : ""}page=${page + 1}&cursor=${encodeURIComponent(lastCursor)}`
    : "/tasks";
  // "Previous" drops the cursor, which returns to page 1 of the same filters.
  const firstHref = prefix ? `/tasks?${prefix}` : "/tasks";

  return (
    <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="mb-2 text-[11px] font-medium text-slate-500">
            Workspace / All tasks
          </p>
          <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            All tasks
          </h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            A workspace-wide view of tasks across every project.
          </p>
        </div>
        <Link
          href="/tasks/new"
          className="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
        >
          ＋ New task
        </Link>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        {/* useSearchParams opts this subtree out of static rendering, so Next
            requires a Suspense boundary around it. */}
        <Suspense fallback={<div className="h-14" />}>
          <TaskFilters
            projects={projects}
            people={people}
            search={search}
            status={statusParam}
            projectId={projectId}
            assigneeId={assigneeId}
          />
        </Suspense>

        <TaskTable tasks={rows} showProject showComments />

        <div className="flex items-center justify-between px-5 py-4 text-[11px] text-slate-500">
          <span>{formatRange({ ...range, filtered })}</span>
          {/* Keyset pagination (spec/queries.md). */}
          <TaskPagination
            hasNewer={onLaterPage}
            hasOlder={hasMore}
            firstHref={firstHref}
            nextHref={nextHref}
            size={size}
          />
        </div>
      </section>
    </div>
  );
}
