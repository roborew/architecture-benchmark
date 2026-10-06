// src/routes/tasks.index.tsx — the workspace-wide task list.
//
// The Next.js page was an async Server Component reading four things at once.
// Here they all go through server functions in a loader, because a loader also
// runs in the browser during client navigation.

import { Link, createFileRoute } from "@tanstack/solid-router";

import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskPagination } from "@/components/tasks/task-pagination";
import { TaskTable } from "@/components/tasks/task-table";
import {
  DEFAULT_PAGE_SIZE,
  formatRange,
  pageRange,
  parsePage,
  parsePageSize,
} from "@/lib/pagination";
import {
  fetchProjects,
  fetchTaskCount,
  fetchTasks,
  fetchUsers,
} from "@/server/queries";

/**
 * The status filter's query-string spelling.
 *
 * A raw space is awkward in a query string while the stored value is "in
 * progress" (spec/contract.md), so the two are translated here and the query
 * layer only ever sees the stored form.
 */
const STATUS_FROM_QUERY: Record<string, string> = {
  todo: "todo",
  "in-progress": "in progress",
  done: "done",
};

/**
 * Next's `searchParams` could hold a repeated key, so each value arrived as
 * `string | string[]` and every read went through `first()`. The router
 * validates the search once, up front, so the loader sees plain strings here.
 *
 * The fields are typed optional so a `<Link to="/tasks">` elsewhere does not
 * have to pass a `search` object; the validator still returns plain strings.
 */
type TasksSearch = {
  q?: string;
  project?: string;
  status?: string;
  assignee?: string;
  cursor?: string;
  page?: string;
  size?: string;
};

/**
 * Coerces a validated search value to a string.
 *
 * TanStack's default search parsing is JSON-based, so `?size=5` yields the
 * number 5 while `?status=done` yields the string "done". Anything that is
 * neither a string nor a finite number (an object, an array, null) is dropped,
 * because those cannot be a meaningful value for any of these params.
 */
export function toParam(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  return undefined;
}

/** A select value is a positive integer id, or nothing when unset. */
function toOptionalId(value: string) {
  if (!value) return undefined;

  const id = Number(value);

  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export const Route = createFileRoute("/tasks/")({
  // Absent params resolve to `undefined`, not "". A validator that returns an
  // empty string makes TanStack write it into the URL, so the bare task list
  // would become /tasks?q=&project=&status=&assignee=&cursor=&page=&size=
  // — an observable difference from the Next.js app, and this route is linked
  // and asserted on constantly. Undefined params are omitted entirely.
  // TanStack's default search parser JSON-parses each value, so `?size=5`
  // arrives as the *number* 5 and `?status=done` as the string "done". A
  // string-only check silently drops every numeric param — page size, page
  // number, project and assignee ids all vanished, and the list quietly fell
  // back to its defaults. Both types are accepted and coerced to a string,
  // which is what the pagination helpers already expect.
  validateSearch: (search: Record<string, unknown>): TasksSearch => ({
    q: toParam(search.q),
    project: toParam(search.project),
    status: toParam(search.status),
    assignee: toParam(search.assignee),
    cursor: toParam(search.cursor),
    page: toParam(search.page),
    size: toParam(search.size),
  }),
  loaderDeps: ({ search }) => ({ ...search }),
  loader: async ({ deps }) => {
    const search = deps.q ?? "";
    const statusParam = deps.status ?? "";
    const projectId = toOptionalId(deps.project ?? "");
    const assigneeId = toOptionalId(deps.assignee ?? "");
    const rawCursor = deps.cursor ?? "";
    const cursor = rawCursor === "" ? null : rawCursor;
    const onLaterPage = cursor !== null;

    // The page size is a query LIMIT, so only the offered values are accepted.
    const size = parsePageSize(deps.size);

    // The cursor does the paging; the page number is display state alongside it,
    // because a keyset walk carries no offset to derive a position from.
    const page = parsePage(deps.page, { hasCursor: onLaterPage });

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

    // Four independent reads, run concurrently. The count backs the summary
    // line the e2e suite asserts, and is a separate aggregate on purpose: a
    // window COUNT would force Postgres to materialise every matching row.
    const [tasks, total, projects, people] = await Promise.all([
      fetchTasks({ data: { ...filters, limit: size + 1, cursor } }),
      fetchTaskCount({ data: filters }),
      fetchProjects({ data: { q: "" } }),
      fetchUsers({ data: { q: "" } }),
    ]);

    // Over-fetched by one so `hasMore` costs no COUNT beyond the one already
    // backing the summary line.
    const hasMore = tasks.length > size;
    const rows = tasks.slice(0, size);
    const lastCursor = rows.at(-1)?.cursorFor;

    // Keyset paging only moves forward from a cursor, so "Previous" re-runs the
    // first page rather than walking backwards through cursors it no longer has.
    //
    // These are built as structured search objects rather than pre-joined href
    // strings. `new URLSearchParams({...})` percent-encodes on construction and
    // `toString()` encodes again, so a value that has been through it arrives
    // double-encoded — ?size=%225%22 — and the route's validator cannot read
    // it. Passing the params themselves lets TanStack own the encoding, once.
    const carried: Record<string, string> = {
      ...(search ? { q: search } : {}),
      ...(statusParam ? { status: statusParam } : {}),
      ...(projectId === undefined ? {} : { project: String(projectId) }),
      ...(assigneeId === undefined ? {} : { assignee: String(assigneeId) }),
      ...(size === DEFAULT_PAGE_SIZE ? {} : { size: String(size) }),
    };

    // "Next" carries the cursor of the last row on this page plus the display
    // page number; "Previous" drops the cursor, returning to page 1 of the
    // same filters.
    const nextSearch = lastCursor
      ? { ...carried, page: String(page + 1), cursor: lastCursor }
      : carried;

    return {
      rows,
      projects,
      people,
      size,
      filtered,
      hasMore,
      onLaterPage,
      // The cursor is opaque and already base64url, so it needs no encoding
      // here — it is passed through to the router as-is.
      firstSearch: carried,
      nextSearch,
      range: pageRange({ page, size, total }),
      filters: {
        search,
        status: statusParam,
        projectId,
        assigneeId,
      },
    };
  },
  component: TasksPage,
});

function TasksPage() {
  const data = Route.useLoaderData();

  return (
    <div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
      <div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p class="mb-2 text-[11px] font-medium text-slate-500">
            Workspace / All tasks
          </p>
          <h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            All tasks
          </h1>
          <p class="mt-1.5 text-[13px] leading-6 text-slate-500">
            A workspace-wide view of tasks across every project.
          </p>
        </div>
        <Link
          to="/tasks/new"
          class="inline-flex items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:border-brand-700 hover:bg-brand-700"
        >
          ＋ New task
        </Link>
      </div>

      <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        <TaskFilters
          projects={data().projects}
          people={data().people}
          search={data().filters.search}
          status={data().filters.status}
          projectId={data().filters.projectId}
          assigneeId={data().filters.assigneeId}
        />

        <TaskTable tasks={data().rows} showProject showComments />

        <div class="flex items-center justify-between px-5 py-4 text-[11px] text-slate-500">
          <span>{formatRange({ ...data().range, filtered: data().filtered })}</span>
          {/* Keyset pagination (spec/queries.md). */}
          <TaskPagination
            hasNewer={data().onLaterPage}
            hasOlder={data().hasMore}
            firstSearch={data().firstSearch}
            nextSearch={data().nextSearch}
            size={data().size}
          />
        </div>
      </section>
    </div>
  );
}
