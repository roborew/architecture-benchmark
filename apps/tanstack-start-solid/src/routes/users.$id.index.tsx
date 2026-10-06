// src/routes/users.$id.index.tsx — one workspace member.
//
// The Next.js page awaited `getUser` and then `getUserTasks` directly. The same
// two-step lookup runs here in the loader, through server functions, so the
// second call can still be keyed on the first one's result.
//
// The not-found outcome is a rendered state rather than `notFound()`, because
// that is what the Next.js page did: it returned inline JSX with a heading and
// a way back to the list.

import { createFileRoute, Link } from "@tanstack/solid-router";
import { Show } from "solid-js";

import { UserDetail } from "@/components/users/user-detail";
import { fetchUser, fetchUserTasks } from "@/server/queries";

export const Route = createFileRoute("/users/$id/")({
  loader: async ({ params }) => {
    const personId = Number(params.id);

    // Scoped by id rather than by display name: the fixture page filtered the
    // in-memory rows on `assigneeName`, which would give two members sharing a
    // name each other's tasks.
    const person = Number.isInteger(personId)
      ? await fetchUser({ data: { id: personId } })
      : null;

    if (!person) {
      return { person: null, tasks: [] };
    }

    const tasks = await fetchUserTasks({ data: { id: person.id } });

    return { person, tasks };
  },
  component: UserDetailPage,
});

function UserDetailPage() {
  const data = Route.useLoaderData();

  return (
    <Show
      fallback={
        <div class="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
          <h1 class="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
            Person not found
          </h1>
          <p class="mt-1.5 text-[13px] leading-6 text-slate-500">
            No workspace member matches that id.
          </p>
          <Link
            to="/users"
            class="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            Back to People
          </Link>
        </div>
      }
      when={data().person}
    >
      <UserDetail person={data().person} tasks={data().tasks} />
    </Show>
  );
}
