import { beforeEach, describe, expect, it, vi } from "vitest";

import { commentsQueryOptions } from "./comments-query";
import { dashboardQueryOptions } from "./dashboard-query";
import { taskQueryOptions, tasksQueryOptions } from "./tasks-query";
import { userQueryOptions, userTasksQueryOptions } from "./users-query";

// The query options are the shared contract between the route loader
// (ensureQueryData) and the component (useQuery): the same options must
// produce the same cache key or the loader's prefetch would never be seen by
// the component. These are the single-fetch options — a key that identifies
// the one row (or aggregate) the request returns.

const {
	getCommentsMock,
	getDashboardMock,
	getTaskMock,
	getUserMock,
	getUserTasksMock,
} = vi.hoisted(() => ({
	getCommentsMock: vi.fn(),
	getDashboardMock: vi.fn(),
	getTaskMock: vi.fn(),
	getUserMock: vi.fn(),
	getUserTasksMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
	getComments: getCommentsMock,
	getDashboard: getDashboardMock,
	getTask: getTaskMock,
	getUser: getUserMock,
	getUserTasks: getUserTasksMock,
}));

beforeEach(() => {
	getCommentsMock.mockReset();
	getDashboardMock.mockReset();
	getTaskMock.mockReset();
	getUserMock.mockReset();
	getUserTasksMock.mockReset();
	getCommentsMock.mockResolvedValue([]);
	getDashboardMock.mockResolvedValue({});
	getTaskMock.mockResolvedValue({});
	getUserMock.mockResolvedValue({});
	getUserTasksMock.mockResolvedValue([]);
});

describe("commentsQueryOptions", () => {
	it("keys the cache by the task id", () => {
		expect(commentsQueryOptions(9).queryKey).toEqual([
			"comments",
			{ taskId: 9 },
		]);
		expect(commentsQueryOptions(10).queryKey).not.toEqual(
			commentsQueryOptions(9).queryKey,
		);
	});

	it("fetches the comments through the api client", async () => {
		const options = commentsQueryOptions(9);

		await (options.queryFn as () => Promise<unknown>)();

		expect(getCommentsMock).toHaveBeenCalledWith(9);
	});
});

describe("taskQueryOptions", () => {
	it("keys the cache by the id, apart from the workspace-wide list", () => {
		expect(taskQueryOptions(4).queryKey).toEqual(["task", { id: 4 }]);
		expect(taskQueryOptions(4).queryKey).not.toEqual(
			tasksQueryOptions().queryKey,
		);
	});

	it("fetches one task, with its project, through the api client", async () => {
		const options = taskQueryOptions(4);

		await (options.queryFn as () => Promise<unknown>)();

		expect(getTaskMock).toHaveBeenCalledWith(4);
	});
});

describe("dashboardQueryOptions", () => {
	it("keys the cache once — the dashboard is one aggregate", () => {
		expect(dashboardQueryOptions().queryKey).toEqual(["dashboard"]);
	});

	it("fetches the aggregate through the api client", async () => {
		const options = dashboardQueryOptions();

		await (options.queryFn as () => Promise<unknown>)();

		expect(getDashboardMock).toHaveBeenCalledWith();
	});
});

describe("userQueryOptions", () => {
	it("keys the cache by the id", () => {
		expect(userQueryOptions(4).queryKey).toEqual(["user", { id: 4 }]);
	});

	it("fetches one member through the api client", async () => {
		const options = userQueryOptions(4);

		await (options.queryFn as () => Promise<unknown>)();

		expect(getUserMock).toHaveBeenCalledWith(4);
	});
});

describe("userTasksQueryOptions", () => {
	it("keys the cache by the id, apart from the member's own row", () => {
		expect(userTasksQueryOptions(4).queryKey).toEqual([
			"user-tasks",
			{ id: 4 },
		]);
		expect(userTasksQueryOptions(4).queryKey).not.toEqual(
			userQueryOptions(4).queryKey,
		);
	});

	it("fetches the member's tasks through the api client", async () => {
		const options = userTasksQueryOptions(4);

		await (options.queryFn as () => Promise<unknown>)();

		expect(getUserTasksMock).toHaveBeenCalledWith(4);
	});
});
