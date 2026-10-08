import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL } from "./api";
import { createComment, getComments } from "./comments";

// The comment documents, exercised against a stubbed global fetch: the
// bounded recent-comments read, and the add-comment mutation with the
// operation's own field names (`body`/`authorId`) — every one a POST to the
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

describe("comments", () => {
	it("fetches a task's comments by id", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { taskComments: [] } }));

		await getComments(9);

		const { url, method, query, variables } = firstCall();
		expect(url).toBe(`${API_URL}/graphql`);
		expect(method).toBe("POST");
		expect(query).toContain("query TaskComments(");
		// The task the comments belong to is a variable now, not a path
		// segment — and it stays the number the caller passed.
		expect(variables).toEqual({ taskId: 9 });
	});

	it("resolves the rows the data envelope carries", async () => {
		const rows = [
			{
				id: 1,
				taskId: 9,
				authorName: "Robin Andrew",
				body: "Notes here.",
				createdAt: "Oct 1, 2026",
			},
		];
		fetchMock.mockResolvedValue(jsonResponse({ data: { taskComments: rows } }));

		await expect(getComments(9)).resolves.toEqual(rows);
	});

	it("adds a comment with the operation's own field names", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { addTaskComment: { ok: true } } }),
		);

		const promise = createComment(9, { body: "Notes here.", authorId: "4" });
		// The reply selects `ok` alone — the API's addTaskComment returns no
		// message and no redirectTo, which is exactly the optional-fields
		// shape of MutationResult.
		await expect(promise).resolves.toEqual({ ok: true });

		const { url, method, query, variables } = firstCall();
		expect(url).toBe(`${API_URL}/graphql`);
		expect(method).toBe("POST");
		expect(query).toContain("mutation AddTaskComment(");
		// The field names are this operation's own (`body`/`authorId`), not the
		// reference form's (`commentBody`/`commentAuthorId`): the API keys its
		// validation errors by the names the request actually sent, so the form
		// that renders those errors must submit the same spelling.
		expect(variables).toEqual({
			taskId: 9,
			body: "Notes here.",
			authorId: "4",
		});
	});
});
