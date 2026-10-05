"use client";

// The delete control for one workspace member.
//
// `comments.author_id` is ON DELETE RESTRICT, so deleting a member who has
// written anything is refused. The procedure returns { ok: false, message } for
// that rather than throwing: it is expected user error, and the reason has to be
// visible right here.
//
// A Client Component because the mutation is an imperative call — unlike the
// Server Action this replaced, a <form action={...}> can no longer submit itself.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ActionResult } from "@/lib/result";
import type { User } from "@/lib/types";
import { orpc } from "@/orpc/client";

export function DeleteUserButton({ person }: { person: User }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  // `orpc.users.delete.mutationOptions()` builds the options object and TanStack's
  // useMutation runs it. The `orpc` object is imported directly — oRPC has no
  // `useTRPC()` equivalent and mounts no provider of its own, so there is no hook
  // to call and no wrapper above this component.
  const deleteUser = useMutation(
    orpc.users.delete.mutationOptions({
      onSuccess: async (result: ActionResult) => {
        if (!result.ok) {
          setMessage(result.message ?? "Failed to delete user.");
          return;
        }

        // Invalidate the whole `users` namespace. This replaces tRPC's
        // `trpc.users.list.queryFilter()`: oRPC exposes one partial-match key
        // builder per router, and `orpc.users.key()` covers `list` and `byId`
        // together — the detail page can be showing the row this delete removed.
        //
        // The braces are required: `.key()` returns an OperationKey tuple, so it
        // is passed as the `queryKey` property of a filter object.
        await queryClient.invalidateQueries({ queryKey: orpc.users.key() });
        router.push("/users");
      },
      onError: () => setMessage("Database Error: Failed to delete user."),
    }),
  );

  return (
    <form
      className="inline"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        deleteUser.mutate({ id: person.id });
      }}
    >
      <button
        type="submit"
        disabled={deleteUser.isPending}
        // The id is in the label as well as the name: `users.display_name` has
        // no UNIQUE constraint, so two members can share a name and two rows
        // would otherwise offer an identically-labelled control.
        aria-label={`Delete ${person.name} (id ${person.id})`}
        className="rounded-md px-0.5 py-0.5 text-[11px] font-semibold text-slate-500 underline transition hover:text-red-600 disabled:opacity-50"
      >
        {deleteUser.isPending ? "Deleting…" : "Delete"}
      </button>
      {message ? (
        <span
          role="alert"
          className="mt-1 block text-[10px] font-semibold text-red-600"
        >
          {message}
        </span>
      ) : null}
    </form>
  );
}
