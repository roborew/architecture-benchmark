import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL } from "./api";
import { getDashboard } from "./dashboard";

// The dashboard document, exercised against a stubbed global fetch: one
// aggregate carrying the three sections the home page renders.

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

describe("dashboard", () => {
	it("fetches the dashboard aggregate", async () => {
		const dashboard = { stats: {}, recentTasks: [], projects: [] };
		fetchMock.mockResolvedValue(jsonResponse({ data: { dashboard } }));

		await expect(getDashboard()).resolves.toEqual(dashboard);

		const [url, init] = fetchMock.mock.calls[0] as [
			string,
			RequestInit | undefined,
		];
		const body = JSON.parse(String(init?.body)) as {
			query: string;
			variables?: Record<string, unknown>;
		};

		expect(url).toBe(`${API_URL}/graphql`);
		expect(init?.method).toBe("POST");
		expect(body.query).toContain("query Dashboard");
		// The document takes no variables — the aggregate is one unfiltered
		// read — so the body carries no variables key at all.
		expect(body.variables).toBeUndefined();
	});
});
