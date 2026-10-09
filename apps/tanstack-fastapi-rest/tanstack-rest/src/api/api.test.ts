import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL, ApiError } from "./api";
import { createTask, deleteTask, getTasks } from "./tasks";
import { getUsers } from "./users";

// The shared half of the api layer, exercised against a stubbed global
// fetch: the error envelope every endpoint shares, and the fallbacks when a
// proxy or a crash hands back something the contract never promised. The
// per-feature endpoint tests (URLs, methods, bodies) live beside their
// modules; these are the pieces every request shares.

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

describe("the error envelope", () => {
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

	it("carries the status and the field → messages map from a 400 body", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{
					error: "Missing fields. Failed to create task.",
					errors: { title: ["Title is required."] },
				},
				400,
			),
		);

		try {
			await getTasks();
			expect.unreachable("the request must reject");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			if (error instanceof ApiError) {
				expect(error.status).toBe(400);
				expect(error.message).toBe("Missing fields. Failed to create task.");
				expect(error.errors).toEqual({ title: ["Title is required."] });
			}
		}
	});

	it("keeps an empty errors map when the body carries none", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ error: "That task no longer exists." }, 404),
		);

		try {
			await getTasks();
			expect.unreachable("the request must reject");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			if (error instanceof ApiError) {
				expect(error.status).toBe(404);
				expect(error.errors).toEqual({});
			}
		}
	});

	it("prefixes every request with the configured base URL", async () => {
		fetchMock.mockResolvedValue(jsonResponse([]));

		await getUsers();

		const [url] = fetchMock.mock.calls[0] as [string];
		expect(url).toBe(`${API_URL}/api/users`);
	});
});

describe("send", () => {
	it("sends a bodyless request with no JSON content type", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

		await deleteTask(9);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init?.method).toBe("DELETE");
		// A bodyless request must not declare application/json: the server would
		// try to parse the absent body as JSON and reject it.
		expect(init?.headers).toBeUndefined();
		expect(init?.body).toBeUndefined();
	});

	it("declares the JSON content type when a body is present", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

		await createTask({ title: "Body" });

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init?.method).toBe("POST");
		expect(init?.headers).toEqual({ "Content-Type": "application/json" });
		expect(typeof init?.body).toBe("string");
	});
});
