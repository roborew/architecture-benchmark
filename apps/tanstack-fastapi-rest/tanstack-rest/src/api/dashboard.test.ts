import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL } from "./api";
import { getDashboard } from "./dashboard";

// The dashboard endpoint, exercised against a stubbed global fetch: one
// aggregate carrying the three sections the home page renders.

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
});

afterEach(() => {
	vi.unstubAllGlobals();
	fetchMock.mockReset();
});

describe("dashboard", () => {
	it("fetches the dashboard aggregate", async () => {
		const dashboard = { stats: {}, recentTasks: [], projects: [] };
		fetchMock.mockResolvedValue(jsonResponse(dashboard));

		await expect(getDashboard()).resolves.toEqual(dashboard);

		const [url] = fetchMock.mock.calls[0] as [string];
		expect(url).toBe(`${API_URL}/api/dashboard`);
	});
});
