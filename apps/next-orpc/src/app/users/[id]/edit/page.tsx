import { notFound } from "next/navigation";
import { UserForm } from "@/app/users/new/_components/user-form";
import { getQueryClient, orpc } from "@/orpc/server";

export default async function EditUserPage({
  params,
}: PageProps<"/users/[id]/edit">) {
  const { id } = await params;
  const personId = Number(id);

  // `Number` yields NaN for anything non-numeric, and a NaN lookup finds no
  // row, so both paths land on the not-found page.
  const person = Number.isInteger(personId)
    ? await getQueryClient().fetchQuery(
        orpc.users.byId.queryOptions({ input: { id: personId } }),
      )
    : null;

  if (!person) {
    notFound();
  }

  return <UserForm person={person} />;
}
