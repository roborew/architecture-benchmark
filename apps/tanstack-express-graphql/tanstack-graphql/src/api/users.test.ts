import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL } from "./api";
import {
	createUser,
	deleteUser,
	getUser,
	getUsers,
	getUserTasks,
	updateUser,
} from "./users";

// The user documents, exercised against a stubbed global fetch: the
// operation and variables each read sends, the rows it returns, and the
// operation and variable bag each mutation sends — every one a POST to the
// single GraphQL endpoint.

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	fetchMock.mockReset();
});

/** The URL, method and parsed `{ query, variables }` body of the first call. */
function firstCall(): {
	url: string;
	method: string;
	query: string;
	variables: Record<string, unknown> | undefined;
} {
	const [url, init] = fetchMock.mock.calls[0] as [
		string,
		RequestInit | undefined,
	];
	const body = JSON.parse(String(init?.body)) as {
		query: string;
		variables?: Record<string, unknown>;
	};

	return {
		url,
		method: String(init?.method),
		query: body.query,
		variables: body.variables,
	};
}

describe("reads", () => {
	it("sends an explicitly empty term as an empty q", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { users: [] } }));

		await getUsers("");

		const { url, query, variables } = firstCall();
		expect(url).toBe(`${API_URL}/graphql`);
		expect(query).toContain("query Users(");
		// Unlike the REST layer (which dropped the q param for an empty term),
		// the document always declares $q and the caller's "" travels — the
		// server owns the rule that an empty term means no filter.
		expect(variables).toEqual({ q: "" });
	});

	it("carries the search term as the q variable", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { users: [] } }));

		await getUsers("Robin Andrew");

		const { query, variables } = firstCall();
		expect(query).toContain("query Users(");
		expect(variables).toEqual({ q: "Robin Andrew" });
	});

	it("returns the parsed rows", async () => {
		const people = [
			{
				id: 1,
				name: "Robin Andrew",
				email: "robin@example.test",
				assignedTaskCount: 2,
				openTaskCount: 2,
				commentCount: 1,
			},
		];
		fetchMock.mockResolvedValue(jsonResponse({ data: { users: people } }));

		await expect(getUsers()).resolves.toEqual(people);
	});

	it("fetches one user by id", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { user: {} } }));

		await getUser(4);

		const { query, variables } = firstCall();
		expect(query).toContain("query User(");
		expect(variables).toEqual({ id: 4 });
	});

	it("fetches a user's assigned tasks by id", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { userTasks: [] } }));

		await getUserTasks(4);

		const { query, variables } = firstCall();
		expect(query).toContain("query UserTasks(");
		expect(variables).toEqual({ userId: 4 });
	});
});

describe("mutations", () => {
	it("creates a user with the form's fields and resolves the envelope", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				data: {
					createUser: { ok: true, message: "Saved.", redirectTo: "/users/4" },
				},
			}),
		);

		const promise = createUser({ name: "Robin", email: "robin@example.test" });
		await expect(promise).resolves.toEqual({
			ok: true,
			message: "Saved.",
			redirectTo: "/users/4",
		});

		const { url, method, query, variables } = firstCall();
		expect(url).toBe(`${API_URL}/graphql`);
		expect(method).toBe("POST");
		expect(query).toContain("mutation CreateUser(");
		expect(variables).toEqual({ name: "Robin", email: "robin@example.test" });
	});

	it("updates a user with its id and the form's fields", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { updateUser: { ok: true } } }),
		);

		await updateUser(4, { name: "Robin", email: "robin@example.test" });

		const { query, variables } = firstCall();
		expect(query).toContain("mutation UpdateUser(");
		expect(variables).toEqual({
			id: 4,
			name: "Robin",
			email: "robin@example.test",
		});
	});

	it("deletes a user by id alone", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { deleteUser: { ok: true } } }),
		);

		await deleteUser(4);

		const { query, variables } = firstCall();
		expect(query).toContain("mutation DeleteUser(");
		expect(variables).toEqual({ id: 4 });
	});
});
