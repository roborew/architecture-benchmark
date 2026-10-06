import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL, getUsers } from "./api";

// The fetch client is exercised against a stubbed global fetch: what URL it
// builds, what it returns, and how it surfaces the API's JSON error envelope.

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status < 400,
		status,
		json: () => Promise.resolve(body),
	} as Response;
}

function nonJsonResponse(status: number): Response {
	return {
		ok: status < 400,
		status,
		json: () => Promise.reject(new Error("Unexpected token in JSON")),
	} as Response;
}

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	fetchMock.mockReset();
});

describe("getUsers", () => {
	it("requests the users endpoint with no query for an empty term", async () => {
		fetchMock.mockResolvedValue(jsonResponse([]));

		await getUsers("");

		const [url] = fetchMock.mock.calls[0];
		expect(url).toBe(`${API_URL}/api/users`);
	});

	it("encodes the search term as the q param", async () => {
		fetchMock.mockResolvedValue(jsonResponse([]));

		await getUsers("Robin Andrew");

		const [url] = fetchMock.mock.calls[0];
		const parsed = new URL(url as string);
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

	it("throws the server's error message on a failure", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ error: "q must be a single value" }, 400),
		);

		await expect(getUsers("robin")).rejects.toThrow("q must be a single value");
	});

	it("falls back to the status when the error body is not JSON", async () => {
		fetchMock.mockResolvedValue(nonJsonResponse(500));

		await expect(getUsers()).rejects.toThrow("Request failed with 500");
	});
});
