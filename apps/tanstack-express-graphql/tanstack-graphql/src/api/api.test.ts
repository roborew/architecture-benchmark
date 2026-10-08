import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL, ApiError } from "./api";
import { createTask, getTask } from "./tasks";
import { getUsers } from "./users";

// The shared half of the api layer, exercised against a stubbed global
// fetch: the error mapping every operation shares — GraphQL answers HTTP 200
// and carries its outcomes in `errors`, with the REST envelope's parts (the
// status line and the field → messages map) travelling in `extensions` — and
// the fallbacks when a proxy or a crash hands back something the contract
// never promised. The per-feature document tests (operations, variables) live
// beside their modules; these are the pieces every request shares.

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

describe("the error envelope", () => {
	it("throws the API's error message on a failure", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				errors: [
					{
						message: "q must be a single value",
						extensions: { code: "BAD_INPUT" },
					},
				],
			}),
		);

		await expect(getUsers("robin")).rejects.toThrow("q must be a single value");
	});

	it("maps NOT_FOUND to the 404 the routes branch on", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				errors: [{ message: "Not found", extensions: { code: "NOT_FOUND" } }],
			}),
		);

		try {
			await getTask(9);
			expect.unreachable("the request must reject");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			if (error instanceof ApiError) {
				expect(error.status).toBe(404);
				expect(error.message).toBe("Not found");
			}
		}
	});

	it("carries the field → messages map from a BAD_INPUT error", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				errors: [
					{
						message: "Missing fields. Failed to create task.",
						extensions: {
							code: "BAD_INPUT",
							errors: { title: ["Title is required."] },
						},
					},
				],
			}),
		);

		try {
			await createTask({ title: "" });
			expect.unreachable("the request must reject");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			if (error instanceof ApiError) {
				expect(error.status).toBe(400);
				expect(error.message).toBe("Missing fields. Failed to create task.");
				// The field keys are the ones the API's validators used — the
				// forms render `errors.title` straight from this map.
				expect(error.errors).toEqual({ title: ["Title is required."] });
			}
		}
	});

	it("keeps an empty errors map when the error carries none", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				errors: [
					{
						message: "That task no longer exists.",
						extensions: { code: "NOT_FOUND" },
					},
				],
			}),
		);

		try {
			await getTask(9);
			expect.unreachable("the request must reject");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			if (error instanceof ApiError) {
				expect(error.status).toBe(404);
				expect(error.errors).toEqual({});
			}
		}
	});

	it("maps CONFLICT to the 409 the guards report", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				errors: [
					{
						message: "Delete the project's tasks first.",
						extensions: { code: "CONFLICT" },
					},
				],
			}),
		);

		try {
			await getTask(9);
			expect.unreachable("the request must reject");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			if (error instanceof ApiError) {
				expect(error.status).toBe(409);
				expect(error.message).toBe("Delete the project's tasks first.");
			}
		}
	});

	it("falls back to 400 when the error carries no code", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ errors: [{ message: "Task not found." }] }),
		);

		try {
			await getTask(9);
			expect.unreachable("the request must reject");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			if (error instanceof ApiError) {
				// The extensions are the only guaranteed facts — a proxy or a
				// crash can hand back an errors array without them, so the
				// mapping falls back the same way the REST envelope's parser did.
				expect(error.status).toBe(400);
				expect(error.message).toBe("Task not found.");
			}
		}
	});

	it("rethrows a network failure as-is, not as an ApiError", async () => {
		const failure = new TypeError("fetch failed");
		fetchMock.mockRejectedValue(failure);

		// There is no status to report when fetch itself rejects — the
		// browser's own error is the most honest thing to surface.
		await expect(getUsers()).rejects.toBe(failure);
		await expect(getUsers()).rejects.not.toBeInstanceOf(ApiError);
	});

	it("prefixes every request with the configured base URL", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { users: [] } }));

		await getUsers();

		const [url, init] = fetchMock.mock.calls[0] as [
			string,
			RequestInit | undefined,
		];
		expect(url).toBe(`${API_URL}/graphql`);
		expect(init?.method).toBe("POST");
	});
});
