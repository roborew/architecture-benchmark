// src/api/comments.ts
//
// How the SPA talks to the server about comments on an existing task: the
// add-comment mutation its form submits. (Creating a task together with its
// first comment is a task mutation — `tasks.ts` — because its atomicity is a
// property of the task insert. The comments read is the query options' own
// procedure now — src/queries/comments-query.ts.)
//
// The field names are the form's own (`body`/`authorId`), not the
// with-comment form's (`commentBody`/`commentAuthorId`): the API keys its
// validation errors by the names the caller actually sent, so the form that
// renders those errors must submit the same spelling.

import { client } from "@/orpc/client";

import { call, type FormValues, type MutationResult } from "./api";

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Adds a comment to an existing task.
 */
export function createComment(
	taskId: number,
	values: FormValues,
): Promise<MutationResult> {
	return call(() => client.tasks.addComment({ id: taskId, ...values }));
}
