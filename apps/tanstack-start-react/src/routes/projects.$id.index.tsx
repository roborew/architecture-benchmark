// src/routes/projects.$id.index.tsx — one project and its task list.
//
// The Next.js page read the project and its tasks directly. Both reads go
// through server functions here, because a loader also runs in the browser
// during client navigation.

import { Link, createFileRoute } from "@tanstack/react-router";

import { ProjectDetail } from "@/components/projects/project-detail";
import { fetchProject, fetchProjectTasks } from "@/server/queries";

/**
 * The status filter's query-string spelling.
 *
 * spec/contract.md stores the value as `in progress` (with a space) and the
 * board's tabs link to that raw spelling, URL-encoded by the router. The query
 * layer only ever sees the stored form. The legacy `in-progress` spelling is
 * still accepted so an older link does not silently clear the filter.
 */
const STATUS_FROM_QUERY: Record<string, string> = {
  todo: "todo",
  "in progress": "in progress",
  "in-progress": "in progress",
  done: "done",
};

/**
 * Over-fetch by one row to learn whether more exist: the extra row is dropped
 * before rendering, so the page still shows at most `PAGE_SIZE` tasks.
 */
const PAGE = 25;

export const Route = createFileRoute("/projects/$id/")({
  // Typed as optional so a `<Link to="/projects/$id">` elsewhere does not have
  // to pass a `search` object; the validator still returns plain strings.
  // Absent params resolve to `undefined`, not "". A validator that returns an
  // empty string makes TanStack write it into the URL, so navigating to a
  // project would land on /projects/1?status=&cursor= instead of /projects/1
  // — an observable difference from the Next.js app and one the e2e suite
  // asserts on. Undefined params are omitted from the search string entirely.
  //
  // Numeric values are coerced as well: TanStack's default search parsing is
  // JSON-based, so a hand-edited ?status=2 would otherwise be dropped rather
  // than rejected by the status check below.
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    status?: string;
    cursor?: string;
  } => ({
    status:
      typeof search.status === "string"
        ? search.status
        : typeof search.status === "number" && Number.isFinite(search.status)
          ? String(search.status)
          : undefined,
    cursor:
      typeof search.cursor === "string"
        ? search.cursor
        : typeof search.cursor === "number" && Number.isFinite(search.cursor)
          ? String(search.cursor)
          : undefined,
  }),
  loaderDeps: ({ search }) => ({ ...search }),
  loader: async ({ params, deps }) => {
    const projectId = Number(params.id);
    const statusParam = deps.status ?? "";
    const cursor = deps.cursor ?? "";

    // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
    // row, so both paths land on the not-found state below.
    const project = Number.isInteger(projectId)
      ? await fetchProject({ data: { id: projectId } })
      : null;

    if (!project) return null;

    const appliedStatus =
      statusParam && statusParam in STATUS_FROM_QUERY
        ? STATUS_FROM_QUERY[statusParam]
        : undefined;

    const fetched = await fetchProjectTasks({
      data: {
        projectId: project.id,
        status: appliedStatus,
        cursor: cursor || undefined,
        limit: PAGE + 1,
      },
    });

    // The tabs render from the canonical stored value, so a raw
    // `?status=in progress` and the legacy `in-progress` both light the same
    // tab. An unknown value applies no filter and leaves `all` active.
    return {
      project,
      tasks: fetched.slice(0, PAGE),
      status: appliedStatus ?? "",
      hasMore: fetched.length > PAGE,
    };
  },
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const data = Route.useLoaderData();

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          Project not found
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          No project matches that id.
        </p>
        <Link
          to="/projects"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <ProjectDetail
      project={data.project}
      tasks={data.tasks}
      status={data.status}
      hasMore={data.hasMore}
    />
  );
}
