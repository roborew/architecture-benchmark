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

// The project documents, exercised against a stubbed global fetch: the
// operation and variables each read sends, and the operation, method and
// variable bag each mutation sends — every one a POST to the single GraphQL
// endpoint.

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
	it("lists projects with the search term as q", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { projects: [] } }));

		await getProjects("redesign");

		const { url, query, variables } = firstCall();
		expect(url).toBe(`${API_URL}/graphql`);
		expect(query).toContain("query Projects(");
		expect(variables).toEqual({ q: "redesign" });
	});

	it("sends an explicitly empty term as an empty q", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { projects: [] } }));

		await getProjects("");

		const { query, variables } = firstCall();
		expect(query).toContain("query Projects(");
		// The empty term is a value the caller chose, so it travels — the
		// server owns the rule that an empty term means no filter.
		expect(variables).toEqual({ q: "" });
	});

	it("fetches one project by id", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { project: {} } }));

		await getProject(3);

		const { query, variables } = firstCall();
		expect(query).toContain("query Project(");
		expect(variables).toEqual({ id: 3 });
	});

	it("fetches a project's board tasks with status, cursor and limit", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { projectTasks: [] } }));

		await getProjectTasks(3, {
			status: "in progress",
			cursor: "Y3Vyc29y",
			limit: 6,
		});

		const { query, variables } = firstCall();
		expect(query).toContain("query ProjectTasks(");
		// The Int filters stay numbers — typed GraphQL variables, not REST
		// query-string spelling.
		expect(variables).toEqual({
			projectId: 3,
			status: "in progress",
			cursor: "Y3Vyc29y",
			limit: 6,
		});
	});

	it("omits absent board filters rather than sending empties", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { projectTasks: [] } }));

		await getProjectTasks(3);

		const { query, variables } = firstCall();
		expect(query).toContain("query ProjectTasks(");
		// An absent filter is an omitted key (undefined, which JSON drops).
		expect(variables).toEqual({ projectId: 3 });
	});

	it("resolves the rows the data envelope carries", async () => {
		const rows = [
			{
				id: 9,
				name: "Website redesign",
				description: "Refresh the marketing site",
				taskCount: 4,
				openTaskCount: 2,
				peopleCount: 3,
				createdAt: "Oct 1, 2026",
			},
		];
		fetchMock.mockResolvedValue(jsonResponse({ data: { projects: rows } }));

		await expect(getProjects()).resolves.toEqual(rows);
	});
});

describe("mutations", () => {
	it("creates a project with the form's fields passed through", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { createProject: { ok: true } } }),
		);

		await createProject({ name: "Website redesign", description: "Refresh" });

		const { url, method, query, variables } = firstCall();
		expect(url).toBe(`${API_URL}/graphql`);
		expect(method).toBe("POST");
		expect(query).toContain("mutation CreateProject(");
		expect(variables).toEqual({
			name: "Website redesign",
			description: "Refresh",
		});
	});

	it("updates a project with its id and the form's fields", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { updateProject: { ok: true } } }),
		);

		await updateProject(3, { name: "Renamed", description: "" });

		const { query, variables } = firstCall();
		expect(query).toContain("mutation UpdateProject(");
		// The empty description travels as the form submitted it.
		expect(variables).toEqual({ id: 3, name: "Renamed", description: "" });
	});

	it("deletes a project by id alone", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { deleteProject: { ok: true } } }),
		);

		await deleteProject(3);

		const { query, variables } = firstCall();
		expect(query).toContain("mutation DeleteProject(");
		expect(variables).toEqual({ id: 3 });
	});

	it("rejects with an ApiError carrying the guard message on a CONFLICT", async () => {
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
