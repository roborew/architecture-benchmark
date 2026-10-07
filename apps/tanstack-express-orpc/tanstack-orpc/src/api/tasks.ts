// src/api/tasks.ts
//
// How the SPA talks to the server about tasks: the mutations its forms
// submit, and the atomic create-with-comment path. Comments on an existing
// task live in `comments.ts`; the reads (the workspace list, the count, one
// task, its comments) are the query options' own procedures now
// (src/queries/tasks-query.ts), so they no longer travel through this layer.
//
// The field bag is passed through untouched (see api.ts): the server owns
// every normalisation rule, and the id rides with the bag because the caller
// already owns it — under REST it rode in the URL.

import { client } from "@/orpc/client";

import { call, type FormValues, type MutationResult } from "./api";

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function createTask(values: FormValues): Promise<MutationResult> {
	return call(() => client.tasks.create({ ...values }));
}

export function updateTask(
	id: number,
	values: FormValues,
): Promise<MutationResult> {
	return call(() => client.tasks.update({ id, ...values }));
}

export function deleteTask(id: number): Promise<MutationResult> {
	return call(() => client.tasks.remove({ id }));
}

/** The atomic create: the task and its first comment are written together. */
export function createTaskWithComment(
	values: FormValues,
): Promise<MutationResult> {
	return call(() => client.tasks.createWithComment({ ...values }));
}
