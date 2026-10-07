// src/api/projects.ts
//
// How the SPA talks to the server about projects: the reads the projects
// pages render, and the mutations its forms submit. Transport details (the
// base URL, the error envelope, the JSON handling) live in `api/api.ts`.

import type { Project, ProjectTaskRow } from "@/lib/types";
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
 * The projects listing. An empty term returns every project; a term filters
 * server-side (ILIKE on name and description).
 */
export function getProjects(term = ""): Promise<Project[]> {
	return requestJson<Project[]>(`/api/projects${toQuery({ q: term })}`);
}

/** One project by id; the API answers 404 with an ApiError when none matches. */
export function getProject(id: number): Promise<Project> {
	return requestJson<Project>(`/api/projects/${id}`);
}

/** The filters a project board's task list accepts. */
export type ProjectTaskQuery = {
	/** A single stored status, or absent for every status. */
	status?: string;
	/** The keyset cursor the previous page ended on; absent means the first page. */
	cursor?: string | null;
	/** Page size; the API clamps it to [1, 26] as the reference does. */
	limit?: number;
};

/**
 * One page of a project's board tasks, newest first. Rows carry `cursorFor` —
 * the opaque tuple the next page starts after — so the caller can page without
 * a second query.
 */
export function getProjectTasks(
	projectId: number,
	filters: ProjectTaskQuery = {},
): Promise<ProjectTaskRow[]> {
	return requestJson<ProjectTaskRow[]>(
		`/api/projects/${projectId}/tasks${toQuery(filters)}`,
	);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function createProject(values: FormValues): Promise<MutationResult> {
	return send("/api/projects", "POST", values);
}

export function updateProject(
	id: number,
	values: FormValues,
): Promise<MutationResult> {
	return send(`/api/projects/${id}`, "PATCH", values);
}

export function deleteProject(id: number): Promise<MutationResult> {
	return send(`/api/projects/${id}`, "DELETE", undefined);
}
