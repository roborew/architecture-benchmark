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

// The task endpoints, exercised against a stubbed global fetch: the URL each
// read builds, and the method, path and JSON body each mutation sends.

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
	it("lists tasks with every filter the workspace route offers", async () => {
		await getTasks({
			q: "navigation",
			status: "todo",
			projectId: 2,
			assigneeId: 4,
			cursor: "Y3Vyc29y",
			limit: 6,
		});

		const [url] = firstCall();
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/api/tasks");
		expect(parsed.searchParams.get("q")).toBe("navigation");
		expect(parsed.searchParams.get("status")).toBe("todo");
		expect(parsed.searchParams.get("projectId")).toBe("2");
		expect(parsed.searchParams.get("assigneeId")).toBe("4");
		expect(parsed.searchParams.get("cursor")).toBe("Y3Vyc29y");
		expect(parsed.searchParams.get("limit")).toBe("6");
	});

	it("omits absent task filters rather than sending empties", async () => {
		await getTasks();

		const [url] = firstCall();
		expect(url).toBe(`${API_URL}/api/tasks`);
	});

	it("encodes a status with a space without hand-encoding it", async () => {
		await getTasks({ status: "in progress" });

		const [url] = firstCall();
		expect(new URL(url).searchParams.get("status")).toBe("in progress");
	});

	it("counts tasks through the count endpoint", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ count: 7 }));

		await expect(getTaskCount({ q: "draft", status: "todo" })).resolves.toBe(7);

		const [url] = firstCall();
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/api/tasks/count");
		expect(parsed.searchParams.get("q")).toBe("draft");
		expect(parsed.searchParams.get("status")).toBe("todo");
	});

	it("fetches one task by id", async () => {
		await getTask(9);

		const [url] = firstCall();
		expect(url).toBe(`${API_URL}/api/tasks/9`);
	});
});

describe("mutations", () => {
	beforeEach(() => {
		fetchMock.mockResolvedValue(
			jsonResponse({ ok: true, message: "Saved.", redirectTo: "/tasks/9" }),
		);
	});

	it("creates a task with the form's fields passed through", async () => {
		await createTask({
			projectId: "2",
			assigneeId: "",
			title: "Draft the model",
			description: "",
			status: "todo",
		});

		const [url, init] = firstCall();
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		expect(url).toBe(`${API_URL}/api/tasks`);
		expect(init?.method).toBe("POST");
		// The empty assignee travels as the form submitted it — the server owns
		// the one normalisation rule ("" means unassigned), so the client cannot
		// disagree with itself about it.
		expect(body).toEqual({
			projectId: "2",
			assigneeId: "",
			title: "Draft the model",
			description: "",
			status: "todo",
		});
	});

	it("updates a task with a PATCH to its id", async () => {
		await updateTask(9, {
			title: "Draft the model",
			description: "",
			status: "in progress",
			assigneeId: "4",
		});

		const [url, init] = firstCall();
		expect(url).toBe(`${API_URL}/api/tasks/9`);
		expect(init?.method).toBe("PATCH");
	});

	it("deletes a task with a DELETE to its id", async () => {
		await deleteTask(9);

		const [url, init] = firstCall();
		expect(url).toBe(`${API_URL}/api/tasks/9`);
		expect(init?.method).toBe("DELETE");
	});

	it("creates a task with its first comment atomically", async () => {
		await createTaskWithComment({
			projectId: "2",
			assigneeId: "",
			title: "Draft the model",
			description: "",
			status: "todo",
			commentBody: "Kicking this off.",
			commentAuthorId: "4",
		});

		const [url, init] = firstCall();
		expect(url).toBe(`${API_URL}/api/tasks/with-comment`);
		expect(init?.method).toBe("POST");
	});

	it("resolves the API's outcome envelope", async () => {
		await expect(createTask({ title: "Draft" })).resolves.toEqual({
			ok: true,
			message: "Saved.",
			redirectTo: "/tasks/9",
		});
	});
});
