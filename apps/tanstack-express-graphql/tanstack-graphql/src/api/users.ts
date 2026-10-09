// src/api/users.ts
//
// How the SPA talks to the server about people: the listing, one member and
// her assigned tasks, and the mutations her forms submit. Transport details
// (the endpoint, the error envelope, the response handling) live in
// `api/api.ts`.

import type { TaskWithProject, User } from "@/lib/types";
import { type FormValues, type MutationResult, request } from "./api";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const USERS_QUERY = /* GraphQL */ `
  query Users($q: String) {
    users(q: $q) {
      id
      name
      email
      assignedTaskCount
      openTaskCount
      commentCount
    }
  }
`;

/**
 * The People listing rows. An empty term returns every member; a term filters
 * server-side (ILIKE on name and email).
 */
export function getUsers(term = ""): Promise<User[]> {
	return request<{ users: User[] }>(USERS_QUERY, { q: term }).then(
		(data) => data.users,
	);
}

const USER_QUERY = /* GraphQL */ `
  query User($id: Int!) {
    user(id: $id) {
      id
      name
      email
      assignedTaskCount
      openTaskCount
      commentCount
    }
  }
`;

/** One member by id; a missing row surfaces as an ApiError. */
export function getUser(id: number): Promise<User> {
	return request<{ user: User }>(USER_QUERY, { id }).then((data) => data.user);
}

const USER_TASKS_QUERY = /* GraphQL */ `
  query UserTasks($userId: Int!) {
    userTasks(userId: $userId) {
      id
      projectId
      projectName
      title
      description
      status
      assigneeName
      commentCount
      updatedAt
    }
  }
`;

/** The tasks assigned to one member, newest first. */
export function getUserTasks(id: number): Promise<TaskWithProject[]> {
	return request<{ userTasks: TaskWithProject[] }>(USER_TASKS_QUERY, {
		userId: id,
	}).then((data) => data.userTasks);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const CREATE_USER_MUTATION = /* GraphQL */ `
  mutation CreateUser($name: String, $email: String) {
    createUser(name: $name, email: $email) {
      ok
      message
      redirectTo
    }
  }
`;

export function createUser(values: FormValues): Promise<MutationResult> {
	return request<{ createUser: MutationResult }>(
		CREATE_USER_MUTATION,
		values,
	).then((data) => data.createUser);
}

const UPDATE_USER_MUTATION = /* GraphQL */ `
  mutation UpdateUser($id: Int!, $name: String, $email: String) {
    updateUser(id: $id, name: $name, email: $email) {
      ok
      message
      redirectTo
    }
  }
`;

export function updateUser(
	id: number,
	values: FormValues,
): Promise<MutationResult> {
	return request<{ updateUser: MutationResult }>(UPDATE_USER_MUTATION, {
		id,
		...values,
	}).then((data) => data.updateUser);
}

const DELETE_USER_MUTATION = /* GraphQL */ `
  mutation DeleteUser($id: Int!) {
    deleteUser(id: $id) {
      ok
      message
      redirectTo
    }
  }
`;

export function deleteUser(id: number): Promise<MutationResult> {
	return request<{ deleteUser: MutationResult }>(DELETE_USER_MUTATION, {
		id,
	}).then((data) => data.deleteUser);
}
