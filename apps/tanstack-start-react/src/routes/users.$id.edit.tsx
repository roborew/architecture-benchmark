// src/routes/users.$id.edit.tsx — the edit form.
//
// `notFound()` in Next.js became `throw notFound()` here. Throwing rather than
// returning matters: it unwinds the loader, so nothing renders on a bad id.
//
// As on the project/task edit routes, the thrown not-found needs a
// `notFoundComponent` boundary on this route. Without it TanStack Router walks
// up to the root looking for one and logs a warning naming `__root__`.

import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { UserForm } from "@/components/users/user-form";
import { fetchUser } from "@/server/queries";

export const Route = createFileRoute("/users/$id/edit")({
  loader: async ({ params }) => {
    const personId = Number(params.id);

    // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
    // row, so both paths land on the not-found page.
    const person = Number.isInteger(personId)
      ? await fetchUser({ data: { id: personId } })
      : null;

    if (!person) {
      throw notFound();
    }

    return person;
  },
  notFoundComponent: UserNotFound,
  component: EditUserPage,
});

function EditUserPage() {
  const person = Route.useLoaderData();

  return <UserForm person={person} />;
}

function UserNotFound() {
  return (
    <div data-testid="not-found">
      <div className="mx-auto w-full max-w-310 px-4 py-7 sm:px-8 sm:py-9">
        <h1 className="text-[29px] font-extrabold tracking-[-.045em] text-slate-800 sm:text-[34px]">
          Person not found
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          No workspace member matches that id.
        </p>
        <Link
          to="/users"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Back to People
        </Link>
      </div>
    </div>
  );
}
