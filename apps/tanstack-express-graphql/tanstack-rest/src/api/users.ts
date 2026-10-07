// src/api/users.ts
//
// How the SPA talks to the server about people: the listing, one member and
// her assigned tasks, and the mutations her forms submit. Transport details
// (the base URL, the error envelope, the JSON handling) live in `api/api.ts`.

import type { TaskWithProject, User } from "@/lib/types";
import {
	type FormValues,
	type MutationResult,
	requestJson,
	send,
	toQuery,
} from "./api";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The People listing rows. An empty term returns every member; a term filters
 * server-side (ILIKE on name and email).
 */
export function getUsers(term = ""): Promise<User[]> {
	return requestJson<User[]>(`/api/users${toQuery({ q: term })}`);
}

/** One member by id; 404 surfaces as an ApiError. */
export function getUser(id: number): Promise<User> {
	return requestJson<User>(`/api/users/${id}`);
}

/** The tasks assigned to one member, newest first. */
export function getUserTasks(id: number): Promise<TaskWithProject[]> {
	return requestJson<TaskWithProject[]>(`/api/users/${id}/tasks`);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function createUser(values: FormValues): Promise<MutationResult> {
	return send("/api/users", "POST", values);
}

export function updateUser(
	id: number,
	values: FormValues,
): Promise<MutationResult> {
	return send(`/api/users/${id}`, "PATCH", values);
}

export function deleteUser(id: number): Promise<MutationResult> {
	return send(`/api/users/${id}`, "DELETE", undefined);
}
