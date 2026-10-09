import Link from "next/link";
import { ProjectDetail } from "@/app/projects/_components/project-detail";
import { getQueryClient, trpc } from "@/trpc/server";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: PageProps<"/projects/[id]"> & {
  searchParams: Promise<{
    status?: string | string[];
    cursor?: string | string[];
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const status = Array.isArray(query.status) ? query.status[0] : query.status;
  const cursor = Array.isArray(query.cursor) ? query.cursor[0] : query.cursor;

  const projectId = Number(id);
  const project = Number.isInteger(projectId)
    ? await getQueryClient().fetchQuery(
        trpc.projects.byId.queryOptions({ id: projectId }),
      )
    : null;
  if (!project) {
    return (
      <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          Project not found
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          No project matches that id.
        </p>
        <Link
          href="/projects"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Back to Projects
        </Link>
      </div>
    );
  }

  // The board's tabs carry the raw stored spelling (`in progress`); the older
  // `/tasks` filters use `in-progress` because a raw space is awkward there.
  // Accept both and translate here so the query layer only ever sees the stored
  // form (spec/contract.md).
  const STATUS_FROM_QUERY: Record<string, string> = {
    todo: "todo",
    "in progress": "in progress",
    "in-progress": "in progress",
    done: "done",
  };

  const appliedStatus =
    status && status in STATUS_FROM_QUERY
      ? STATUS_FROM_QUERY[status]
      : undefined;

  // Over-fetch by one row to learn whether more exist: the extra row is dropped
  // before rendering, so the page still shows at most `PAGE_SIZE` tasks.
  const PAGE = 25;
  const fetched = await getQueryClient().fetchQuery(
    trpc.projects.tasks.queryOptions({
      id: project.id,
      status: appliedStatus,
      cursor,
      limit: PAGE + 1,
    }),
  );

  const tasks = fetched.slice(0, PAGE);
  const hasMore = fetched.length > PAGE;

  // The tabs compare against the raw stored value, so hand them the applied
  // status rather than the query-string spelling.
  return (
    <ProjectDetail
      project={project}
      tasks={tasks}
      status={appliedStatus ?? ""}
      hasMore={hasMore}
    />
  );
}
