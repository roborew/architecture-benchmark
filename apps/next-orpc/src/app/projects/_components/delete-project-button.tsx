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

import type { ActionResult } from "@/lib/result";
import { orpc } from "@/orpc/client";

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  // `orpc.projects.delete.mutationOptions()` builds the options object and
  // TanStack's useMutation runs it. `orpc` is imported directly — oRPC has no
  // `useTRPC()` equivalent and mounts no provider of its own.
  const deleteProject = useMutation(
    orpc.projects.delete.mutationOptions({
      onSuccess: async (result: ActionResult) => {
        if (!result.ok) {
          setMessage(result.message ?? "Failed to delete project.");
          return;
        }

        // Invalidate the whole `projects` namespace, replacing tRPC's
        // `orpc.projects.list.queryFilter()`. `.key()` is a partial match, so
        // the detail page is covered too — it can be showing the project this
        // delete just removed. The braces are required: `.key()` returns an
        // OperationKey tuple, not a bare query key.
        await queryClient.invalidateQueries({ queryKey: orpc.projects.key() });
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
