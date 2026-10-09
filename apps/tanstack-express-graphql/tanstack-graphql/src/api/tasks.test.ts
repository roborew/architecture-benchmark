import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL } from "./api";
import {
	createTask,
	createTaskWithComment,
	deleteTask,
	getTask,
	getTaskCount,
	getTasks,
	updateTask,
} from "./tasks";

// The task documents, exercised against a stubbed global fetch: the
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

/**
 * The URL, method and parsed request body of the first call.
 *
 * Every operation is a POST of `{ query, variables }` JSON to the one
 * endpoint, so the interesting facts are which document ran and which
 * variables it carried.
 */
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
	it("lists tasks with every filter the workspace route offers", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { tasks: [] } }));

		await getTasks({
			q: "navigation",
			status: "todo",
			projectId: 2,
			assigneeId: 4,
			cursor: "Y3Vyc29y",
			limit: 6,
		});

		const { url, method, query, variables } = firstCall();
		expect(url).toBe(`${API_URL}/graphql`);
		expect(method).toBe("POST");
		// The operation name is the document's own; the substring is enough to
		// know the right document ran.
		expect(query).toContain("query Tasks(");
		// The Int filters stay numbers — typed GraphQL variables, not REST
		// query-string spelling.
		expect(variables).toEqual({
			q: "navigation",
			status: "todo",
			projectId: 2,
			assigneeId: 4,
			cursor: "Y3Vyc29y",
			limit: 6,
		});
	});

	it("omits absent task filters rather than sending empties", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { tasks: [] } }));

		await getTasks();

		const { url, variables } = firstCall();
		expect(url).toBe(`${API_URL}/graphql`);
		// An absent filter is an omitted key (undefined, which JSON drops) —
		// the same omit-empties rule the REST layer had.
		expect(variables).toEqual({});
	});

	it("sends a status with a space without hand-encoding it", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { tasks: [] } }));

		await getTasks({ status: "in progress" });

		const { variables } = firstCall();
		// The status rides inside JSON, so a space is just a space — no
		// percent-encoding to get wrong.
		expect(variables).toEqual({ status: "in progress" });
	});

	it("counts tasks through the count document", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { taskCount: 7 } }));

		await expect(getTaskCount({ q: "draft", status: "todo" })).resolves.toBe(7);

		const { query, variables } = firstCall();
		// The count is a separate aggregate on purpose: it takes the filters
		// but no paging — its document declares no cursor or limit.
		expect(query).toContain("query TaskCount(");
		expect(query).not.toContain("$cursor");
		expect(query).not.toContain("$limit");
		expect(variables).toEqual({ q: "draft", status: "todo" });
	});

	it("fetches one task by id", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ data: { task: {} } }));

		await getTask(9);

		const { query, variables } = firstCall();
		expect(query).toContain("query Task(");
		expect(variables).toEqual({ id: 9 });
	});

	it("resolves the rows the data envelope carries", async () => {
		const rows = [
			{
				id: 9,
				projectId: 2,
				projectName: "Website redesign",
				title: "Draft the model",
				description: "",
				status: "todo",
				assigneeName: "Robin Andrew",
				commentCount: 1,
				updatedAt: "Oct 1, 2026",
				updatedAtRaw: "2026-10-01T12:00:00.000Z",
				cursorFor: "Y3Vyc29y",
			},
		];
		fetchMock.mockResolvedValue(jsonResponse({ data: { tasks: rows } }));

		await expect(getTasks()).resolves.toEqual(rows);
	});
});

describe("mutations", () => {
	it("creates a task with the form's fields passed through", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { createTask: { ok: true } } }),
		);

		await createTask({
			projectId: "2",
			assigneeId: "",
			title: "Draft the model",
			description: "",
			status: "todo",
		});

		const { url, method, query, variables } = firstCall();
		expect(url).toBe(`${API_URL}/graphql`);
		expect(method).toBe("POST");
		expect(query).toContain("mutation CreateTask(");
		// The empty assignee travels as the form submitted it — the server owns
		// the one normalisation rule ("" means unassigned), so the client cannot
		// disagree with itself about it.
		expect(variables).toEqual({
			projectId: "2",
			assigneeId: "",
			title: "Draft the model",
			description: "",
			status: "todo",
		});
	});

	it("updates a task with its id and the form's fields", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { updateTask: { ok: true } } }),
		);

		await updateTask(9, {
			title: "Draft the model",
			description: "",
			status: "in progress",
			assigneeId: "4",
		});

		const { query, variables } = firstCall();
		expect(query).toContain("mutation UpdateTask(");
		// The id rides along as an Int variable — the number the caller passed,
		// not a path segment.
		expect(variables).toEqual({
			id: 9,
			title: "Draft the model",
			description: "",
			status: "in progress",
			assigneeId: "4",
		});
	});

	it("deletes a task by id alone", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { deleteTask: { ok: true } } }),
		);

		await deleteTask(9);

		const { query, variables } = firstCall();
		expect(query).toContain("mutation DeleteTask(");
		expect(variables).toEqual({ id: 9 });
	});

	it("creates a task with its first comment atomically", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { createTaskWithComment: { ok: true } } }),
		);

		await createTaskWithComment({
			projectId: "2",
			assigneeId: "",
			title: "Draft the model",
			description: "",
			status: "todo",
			commentBody: "Kicking this off.",
			commentAuthorId: "4",
		});

		const { query, variables } = firstCall();
		expect(query).toContain("mutation CreateTaskWithComment(");
		// The whole bag — task fields and comment fields together — is the
		// atomic unit the server writes in one transaction.
		expect(variables).toEqual({
			projectId: "2",
			assigneeId: "",
			title: "Draft the model",
			description: "",
			status: "todo",
			commentBody: "Kicking this off.",
			commentAuthorId: "4",
		});
	});

	it("resolves the API's outcome envelope", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				data: {
					createTask: { ok: true, message: "Saved.", redirectTo: "/tasks/9" },
				},
			}),
		);

		await expect(createTask({ title: "Draft" })).resolves.toEqual({
			ok: true,
			message: "Saved.",
			redirectTo: "/tasks/9",
		});
	});
});
