import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL, ApiError } from "./api";
import {
	createProject,
	deleteProject,
	getProject,
	getProjects,
	getProjectTasks,
	updateProject,
} from "./projects";

// The projects endpoints, exercised against a stubbed global fetch: the URL
// each read builds, and the method, path and JSON body each mutation sends.

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
	it("lists projects with the search term as q", async () => {
		await getProjects("redesign");

		const [url] = firstCall();
		expect(new URL(url).pathname).toBe("/api/projects");
		expect(new URL(url).searchParams.get("q")).toBe("redesign");
	});

	it("omits the query entirely for an empty project term", async () => {
		await getProjects("");

		const [url] = firstCall();
		expect(url).toBe(`${API_URL}/api/projects`);
	});

	it("fetches one project by id", async () => {
		await getProject(3);

		const [url] = firstCall();
		expect(url).toBe(`${API_URL}/api/projects/3`);
	});

	it("fetches a project's board tasks with status, cursor and limit", async () => {
		await getProjectTasks(3, {
			status: "in progress",
			cursor: "Y3Vyc29y",
			limit: 6,
		});

		const [url] = firstCall();
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/api/projects/3/tasks");
		expect(parsed.searchParams.get("status")).toBe("in progress");
		expect(parsed.searchParams.get("cursor")).toBe("Y3Vyc29y");
		expect(parsed.searchParams.get("limit")).toBe("6");
	});

	it("omits absent board filters rather than sending empties", async () => {
		await getProjectTasks(3);

		const [url] = firstCall();
		expect(url).toBe(`${API_URL}/api/projects/3/tasks`);
	});
});

describe("mutations", () => {
	beforeEach(() => {
		fetchMock.mockResolvedValue(
			jsonResponse({ ok: true, message: "Saved.", redirectTo: "/projects/3" }),
		);
	});

	it("creates a project with a POST and a JSON body", async () => {
		await createProject({ name: "Website redesign", description: "Refresh" });

		const [url, init] = firstCall();
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		expect(url).toBe(`${API_URL}/api/projects`);
		expect(init?.method).toBe("POST");
		expect(body).toEqual({ name: "Website redesign", description: "Refresh" });
	});

	it("updates a project with a PATCH to its id", async () => {
		await updateProject(3, { name: "Renamed", description: "" });

		const [url, init] = firstCall();
		expect(url).toBe(`${API_URL}/api/projects/3`);
		expect(init?.method).toBe("PATCH");
	});

	it("deletes a project with a DELETE to its id", async () => {
		await deleteProject(3);

		const [url, init] = firstCall();
		expect(url).toBe(`${API_URL}/api/projects/3`);
		expect(init?.method).toBe("DELETE");
	});

	it("rejects with an ApiError carrying the guard message on a 409", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ error: "Delete the project's tasks first." }, 409),
		);

		try {
			await deleteProject(3);
			expect.unreachable("the request must reject");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			if (error instanceof ApiError) {
				expect(error.status).toBe(409);
				expect(error.message).toBe("Delete the project's tasks first.");
			}
		}
	});
});
