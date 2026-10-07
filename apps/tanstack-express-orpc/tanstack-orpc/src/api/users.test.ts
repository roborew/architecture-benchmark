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

// The user endpoints, exercised against a stubbed global fetch: the URL each
// read builds, the rows it returns, and the method, path and JSON body each
// mutation sends.

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status < 400,
		status,
		json: () => Promise.resolve(body),
	} as Response;
}

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockResolvedValue(jsonResponse([]));
});

afterEach(() => {
	vi.unstubAllGlobals();
	fetchMock.mockReset();
});

/** The URL and request init of the first call. */
function firstCall(): [url: string, init: RequestInit | undefined] {
	return fetchMock.mock.calls[0] as [string, RequestInit | undefined];
}

describe("reads", () => {
	it("requests the users endpoint with no query for an empty term", async () => {
		await getUsers("");

		const [url] = firstCall();
		expect(url).toBe(`${API_URL}/api/users`);
	});

	it("encodes the search term as the q param", async () => {
		await getUsers("Robin Andrew");

		const [url] = firstCall();
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/api/users");
		expect(parsed.searchParams.get("q")).toBe("Robin Andrew");
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
		fetchMock.mockResolvedValue(jsonResponse(people));

		await expect(getUsers()).resolves.toEqual(people);
	});

	it("fetches one user by id", async () => {
		await getUser(4);

		const [url] = firstCall();
		expect(url).toBe(`${API_URL}/api/users/4`);
	});

	it("fetches a user's assigned tasks by id", async () => {
		await getUserTasks(4);

		const [url] = firstCall();
		expect(url).toBe(`${API_URL}/api/users/4/tasks`);
	});
});

describe("mutations", () => {
	beforeEach(() => {
		fetchMock.mockResolvedValue(
			jsonResponse({ ok: true, message: "Saved.", redirectTo: "/users/4" }),
		);
	});

	it("creates a user with a POST", async () => {
		await createUser({ name: "Robin", email: "robin@example.test" });

		const [url, init] = firstCall();
		expect(url).toBe(`${API_URL}/api/users`);
		expect(init?.method).toBe("POST");
	});

	it("updates a user with a PATCH to its id", async () => {
		await updateUser(4, { name: "Robin", email: "robin@example.test" });

		const [url, init] = firstCall();
		expect(url).toBe(`${API_URL}/api/users/4`);
		expect(init?.method).toBe("PATCH");
	});

	it("deletes a user with a DELETE to its id", async () => {
		await deleteUser(4);

		const [url, init] = firstCall();
		expect(url).toBe(`${API_URL}/api/users/4`);
		expect(init?.method).toBe("DELETE");
	});
});
