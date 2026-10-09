// src/api/projects.ts
//
// How the SPA talks to the server about projects: the mutations its forms
// submit. The reads (the listing, one project, the task board) are the query
// options' own procedures now (src/queries/projects-query.ts), so they no
// longer travel through this layer.
//
// The field bag is passed through untouched (see api.ts): the server owns
// every normalisation rule, and the id rides with the bag because the caller
// already owns it — under REST it rode in the URL.

import { client } from "@/orpc/client";

import { call, type FormValues, type MutationResult } from "./api";

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function createProject(values: FormValues): Promise<MutationResult> {
	return call(() => client.projects.create({ ...values }));
}

export function updateProject(
	id: number,
	values: FormValues,
): Promise<MutationResult> {
	return call(() => client.projects.update({ id, ...values }));
}

export function deleteProject(id: number): Promise<MutationResult> {
	return call(() => client.projects.remove({ id }));
}
