"use client";

// The delete control for one project row.
//
// `tasks.project_id` is ON DELETE RESTRICT, so deleting a project that still has
// tasks is refused. The procedure returns { ok: false, message } for that rather
// than throwing: it is expected user error, and the reason has to be visible right
// here.
//
// A Client Component because the mutation is an imperative call — unlike the
// Server Action this replaced, a <form action={...}> can no longer submit itself.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ActionResult } from "@/trpc/result";
import { useTRPC } from "@/trpc/client";

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  // `trpc.projects.delete.mutationOptions()` builds the options object and
  // TanStack's useMutation runs it. There is no `trpc.projects.delete.useMutation()`
  // in @trpc/tanstack-react-query — that was the old @trpc/react-query API.
  const deleteProject = useMutation(
    trpc.projects.delete.mutationOptions({
      onSuccess: async (result: ActionResult) => {
        if (!result.ok) {
          setMessage(result.message ?? "Failed to delete project.");
          return;
        }

        // queryClient + queryFilter(), NOT trpc.useUtils() — the utils proxy does
        // not exist in @trpc/tanstack-react-query.
        await queryClient.invalidateQueries(trpc.projects.list.queryFilter());
        router.push("/projects");
      },
      onError: () => setMessage("Database Error: Failed to delete project."),
    }),
  );

  return (
    <form
      className="inline"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        deleteProject.mutate({ id: projectId });
      }}
    >
      <button
        type="submit"
        disabled={deleteProject.isPending}
        // The accessible name names the project, so a screen-reader user moving
        // through the list hears which row this deletes.
        aria-label={`Delete ${projectName}`}
        className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 underline transition hover:text-red-600 disabled:opacity-50"
      >
        {deleteProject.isPending ? "Deleting…" : "Delete"}
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
