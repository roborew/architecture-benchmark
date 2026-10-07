import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL } from "./api";
import { createComment, getComments } from "./comments";

// The comment endpoints, exercised against a stubbed global fetch: the
// bounded recent-comments read, and the add-comment mutation with the
// endpoint's own field names (`body`/`authorId`).

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

describe("comments", () => {
	it("fetches a task's comments by id", async () => {
		await getComments(9);

		const [url] = firstCall();
		expect(url).toBe(`${API_URL}/api/tasks/9/comments`);
	});

	it("adds a comment with the endpoint's own field names", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true }, 201));

		await createComment(9, { body: "Notes here.", authorId: "4" });

		const [url, init] = firstCall();
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		expect(url).toBe(`${API_URL}/api/tasks/9/comments`);
		expect(init?.method).toBe("POST");
		expect(body).toEqual({ body: "Notes here.", authorId: "4" });
	});
});
