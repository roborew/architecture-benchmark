import { beforeEach, describe, expect, it, vi } from "vitest";

import { taskCountQueryOptions, tasksQueryOptions } from "./tasks-query";

// The query options are the shared contract between the route loader
// (ensureQueryData) and the component (useQuery): the same options must
// produce the same cache key or the loader's prefetch would never be seen by
// the component. The key must also agree with the request: two filter sets
// that build the same URL (an absent term and an empty one) must be one cache
// entry, or the prefetch and the read would silently miss each other.

const { getTasksMock, getTaskCountMock } = vi.hoisted(() => ({
	getTasksMock: vi.fn(),
	getTaskCountMock: vi.fn(),
}));

vi.mock("@/api/tasks", () => ({
	getTasks: getTasksMock,
	getTaskCount: getTaskCountMock,
}));

beforeEach(() => {
	getTasksMock.mockReset();
	getTasksMock.mockResolvedValue([]);
	getTaskCountMock.mockReset();
	getTaskCountMock.mockResolvedValue(0);
});

describe("tasksQueryOptions", () => {
	it("keys the cache by the filters that build the request", () => {
		expect(tasksQueryOptions({ q: "robin", status: "todo" }).queryKey).toEqual([
			"tasks",
			{ q: "robin", status: "todo" },
		]);
	});

	it("drops empty filters from the key, as the request does from the URL", () => {
		// ?q= and no q at all are the same request, so they must be the same
		// cache entry: a loader prefetching one and a component reading the
		// other would otherwise miss.
		expect(tasksQueryOptions({ q: "" }).queryKey).toEqual(["tasks", {}]);
		expect(tasksQueryOptions({}).queryKey).toEqual(["tasks", {}]);
	});

	it("treats a null cursor and an absent one as the same first page", () => {
		expect(tasksQueryOptions({ cursor: null }).queryKey).toEqual(
			tasksQueryOptions({}).queryKey,
		);
	});

	it("keys every request-affecting filter", () => {
		const filters = {
			q: "draft",
			status: "in progress",
			projectId: 2,
			assigneeId: 4,
			cursor: "Y3Vyc29y",
			limit: 6,
		};

		expect(tasksQueryOptions(filters).queryKey).toEqual(["tasks", filters]);
	});

	it("builds distinct keys for distinct filters", () => {
		const first = tasksQueryOptions({ q: "robin" }).queryKey;
		const second = tasksQueryOptions({ q: "sam" }).queryKey;

		expect(first).not.toEqual(second);
	});

	it("fetches through the api client with the filters", async () => {
		const options = tasksQueryOptions({ q: "robin", status: "todo" });

		// queryFn is optional in the options' static shape; the cast asserts the
		// wiring this test exists to pin.
		await (options.queryFn as () => Promise<unknown>)();

		expect(getTasksMock).toHaveBeenCalledWith({ q: "robin", status: "todo" });
	});
});

describe("taskCountQueryOptions", () => {
	it("keys the count cache separately from the list", () => {
		// The count is a different aggregate with a different lifetime: a stale
		// list page after a mutation must not be able to answer a fresh count
		// read from the list's entry, or the summary line would lag the data.
		expect(taskCountQueryOptions({ q: "robin" }).queryKey).not.toEqual(
			tasksQueryOptions({ q: "robin" }).queryKey,
		);
	});

	it("keys the cache by the filters that build the request", () => {
		expect(
			taskCountQueryOptions({ q: "robin", status: "todo", projectId: 2 })
				.queryKey,
		).toEqual(["task-count", { q: "robin", status: "todo", projectId: 2 }]);
	});

	it("drops empty filters from the key, as the request does from the URL", () => {
		expect(taskCountQueryOptions({ q: "" }).queryKey).toEqual([
			"task-count",
			{},
		]);
		expect(taskCountQueryOptions().queryKey).toEqual(["task-count", {}]);
	});

	it("fetches through the api client with the filters", async () => {
		const options = taskCountQueryOptions({ q: "robin" });

		await (options.queryFn as () => Promise<unknown>)();

		expect(getTaskCountMock).toHaveBeenCalledWith({ q: "robin" });
	});
});
