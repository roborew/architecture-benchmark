import Link from "next/link";
import { UserDetail } from "./_components/user-detail";
import { getQueryClient, trpc } from "@/trpc/server";

export default async function UserDetailPage({
  params,
}: PageProps<"/users/[id]">) {
  const { id } = await params;
  const personId = Number(id);

  // Scoped by id rather than by display name: the fixture page filtered the
  // in-memory rows on `assigneeName`, which would give two members sharing a
  // name each other's tasks.
  const person = Number.isInteger(personId)
    ? await getQueryClient().fetchQuery(
        trpc.users.byId.queryOptions({ id: personId })
      )
    : null;

  if (!person) {
    return (
      <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          Person not found
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          No workspace member matches that id.
        </p>
        <Link
          href="/users"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Back to People
        </Link>
      </div>
    );
  }

  const tasks = await getQueryClient().fetchQuery(
    trpc.users.tasks.queryOptions({ id: person.id }),
  );

  return <UserDetail person={person} tasks={tasks} />;
}
