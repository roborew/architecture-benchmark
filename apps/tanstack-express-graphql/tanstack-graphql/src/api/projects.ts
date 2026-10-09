// src/api/projects.ts
//
// How the SPA talks to the server about projects: the reads the projects
// pages render, and the mutations its forms submit. Transport details (the
// endpoint, the error envelope, the response handling) live in `api/api.ts`.

import type { Project, ProjectTaskRow } from "@/lib/types";
import { type FormValues, type MutationResult, request } from "./api";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const PROJECTS_QUERY = /* GraphQL */ `
  query Projects($q: String) {
    projects(q: $q) {
      id
      name
      description
      taskCount
      openTaskCount
      peopleCount
      createdAt
    }
  }
`;

/**
 * The projects listing. An empty term returns every project; a term filters
 * server-side (ILIKE on name and description).
 */
export function getProjects(term = ""): Promise<Project[]> {
	return request<{ projects: Project[] }>(PROJECTS_QUERY, { q: term }).then(
		(data) => data.projects,
	);
}

const PROJECT_QUERY = /* GraphQL */ `
  query Project($id: Int!) {
    project(id: $id) {
      id
      name
      description
      taskCount
      openTaskCount
      peopleCount
      createdAt
    }
  }
`;

/** One project by id; the API answers a missing row with an ApiError. */
export function getProject(id: number): Promise<Project> {
	return request<{ project: Project }>(PROJECT_QUERY, { id }).then(
		(data) => data.project,
	);
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

const PROJECT_TASKS_QUERY = /* GraphQL */ `
  query ProjectTasks(
    $projectId: Int!
    $status: String
    $cursor: String
    $limit: Int
  ) {
    projectTasks(
      projectId: $projectId
      status: $status
      cursor: $cursor
      limit: $limit
    ) {
      id
      projectId
      projectName
      title
      description
      status
      assigneeName
      commentCount
      updatedAt
      createdAtRaw
      cursorFor
    }
  }
`;

/**
 * One page of a project's board tasks, newest first. Rows carry `cursorFor` —
 * the opaque tuple the next page starts after — so the caller can page without
 * a second query.
 */
export function getProjectTasks(
	projectId: number,
	filters: ProjectTaskQuery = {},
): Promise<ProjectTaskRow[]> {
	return request<{ projectTasks: ProjectTaskRow[] }>(PROJECT_TASKS_QUERY, {
		projectId,
		...filters,
	}).then((data) => data.projectTasks);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const CREATE_PROJECT_MUTATION = /* GraphQL */ `
  mutation CreateProject($name: String, $description: String) {
    createProject(name: $name, description: $description) {
      ok
      message
      redirectTo
    }
  }
`;

export function createProject(values: FormValues): Promise<MutationResult> {
	return request<{ createProject: MutationResult }>(
		CREATE_PROJECT_MUTATION,
		values,
	).then((data) => data.createProject);
}

const UPDATE_PROJECT_MUTATION = /* GraphQL */ `
  mutation UpdateProject($id: Int!, $name: String, $description: String) {
    updateProject(id: $id, name: $name, description: $description) {
      ok
      message
      redirectTo
    }
  }
`;

export function updateProject(
	id: number,
	values: FormValues,
): Promise<MutationResult> {
	return request<{ updateProject: MutationResult }>(UPDATE_PROJECT_MUTATION, {
		id,
		...values,
	}).then((data) => data.updateProject);
}

const DELETE_PROJECT_MUTATION = /* GraphQL */ `
  mutation DeleteProject($id: Int!) {
    deleteProject(id: $id) {
      ok
      message
      redirectTo
    }
  }
`;

export function deleteProject(id: number): Promise<MutationResult> {
	return request<{ deleteProject: MutationResult }>(DELETE_PROJECT_MUTATION, {
		id,
	}).then((data) => data.deleteProject);
}
