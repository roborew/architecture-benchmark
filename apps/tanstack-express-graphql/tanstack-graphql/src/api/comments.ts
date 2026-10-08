// src/api/comments.ts
//
// How the SPA talks to the server about comments on an existing task: the
// bounded recent-comments read the task detail renders, and the add-comment
// mutation its form submits. (Creating a task together with its first
// comment is a task mutation — `tasks.ts` — because its atomicity is a
// property of the task insert.) Transport details live in `api/api.ts`.
//
// The field names are this operation's own (`body`/`authorId`), not the
// reference form's (`commentBody`/`commentAuthorId`): the API keys its
// validation errors by the names the request actually sent, so the form that
// renders those errors must submit the same spelling.

import type { Comment } from "@/lib/types";
import { type FormValues, type MutationResult, request } from "./api";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const TASK_COMMENTS_QUERY = /* GraphQL */ `
  query TaskComments($taskId: Int!) {
    taskComments(taskId: $taskId) {
      id
      taskId
      authorName
      body
      createdAt
    }
  }
`;

/** The 10 most recent comments on one task, newest first. */
export function getComments(taskId: number): Promise<Comment[]> {
	return request<{ taskComments: Comment[] }>(TASK_COMMENTS_QUERY, {
		taskId,
	}).then((data) => data.taskComments);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const ADD_TASK_COMMENT_MUTATION = /* GraphQL */ `
  mutation AddTaskComment($taskId: Int!, $body: String, $authorId: String) {
    addTaskComment(taskId: $taskId, body: $body, authorId: $authorId) {
      ok
    }
  }
`;

/**
 * Adds a comment to an existing task.
 *
 * The reply selects `ok` alone: the API's `addTaskComment` returns no message
 * and no `redirectTo` (the user stays on the detail page and the refreshed
 * list above the form shows the result), which is exactly the optional-fields
 * shape of `MutationResult`.
 */
export function createComment(
	taskId: number,
	values: FormValues,
): Promise<MutationResult> {
	return request<{ addTaskComment: MutationResult }>(
		ADD_TASK_COMMENT_MUTATION,
		{ taskId, ...values },
	).then((data) => data.addTaskComment);
}
