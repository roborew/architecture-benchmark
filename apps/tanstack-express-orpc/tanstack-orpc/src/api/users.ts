// src/api/users.ts
//
// How the SPA talks to the server about people: the mutations their forms
// submit. The reads (the listing, one member, her assigned tasks) are the
// query options' own procedures now (src/queries/users-query.ts), so they no
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

export function createUser(values: FormValues): Promise<MutationResult> {
	return call(() => client.users.create({ ...values }));
}

export function updateUser(
	id: number,
	values: FormValues,
): Promise<MutationResult> {
	return call(() => client.users.update({ id, ...values }));
}

export function deleteUser(id: number): Promise<MutationResult> {
	return call(() => client.users.remove({ id }));
}
