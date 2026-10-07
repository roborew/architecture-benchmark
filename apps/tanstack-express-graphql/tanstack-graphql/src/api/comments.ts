// src/api/comments.ts
//
// How the SPA talks to the server about comments on an existing task: the
// bounded recent-comments read the task detail renders, and the add-comment
// mutation its form submits. (Creating a task together with its first
// comment is a task mutation — `tasks.ts` — because its atomicity is a
// property of the task insert.) Transport details live in `api/api.ts`.

import type { Comment } from "@/lib/types";
import { type FormValues, type MutationResult, requestJson, send } from "./api";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The 10 most recent comments on one task, newest first. */
export function getComments(taskId: number): Promise<Comment[]> {
	return requestJson<Comment[]>(`/api/tasks/${taskId}/comments`);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Adds a comment to an existing task.
 *
 * The field names are this endpoint's own (`body`/`authorId`), not the
 * reference form's (`commentBody`/`commentAuthorId`): the API keys its
 * validation errors by the names the request actually sent, so the form that
 * renders those errors must submit the same spelling.
 */
export function createComment(
	taskId: number,
	values: FormValues,
): Promise<MutationResult> {
	return send(`/api/tasks/${taskId}/comments`, "POST", values);
}
