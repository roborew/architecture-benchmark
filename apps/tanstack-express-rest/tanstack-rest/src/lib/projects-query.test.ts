import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	projectQueryOptions,
	projectsQueryOptions,
	projectTasksQueryOptions,
} from "./projects-query";

// The query options are the shared contract between the route loader
// (ensureQueryData) and the component (useQuery): the same options must
// produce the same cache key or the loader's prefetch would never be seen by
// the component.

const { getProjectMock, getProjectTasksMock, getProjectsMock } = vi.hoisted(
	() => ({
		getProjectMock: vi.fn(),
		getProjectTasksMock: vi.fn(),
		getProjectsMock: vi.fn(),
	}),
);

vi.mock("@/lib/api", () => ({
	getProject: getProjectMock,
	getProjectTasks: getProjectTasksMock,
	getProjects: getProjectsMock,
}));

beforeEach(() => {
	getProjectMock.mockReset();
	getProjectTasksMock.mockReset();
	getProjectsMock.mockReset();
	getProjectMock.mockResolvedValue({});
	getProjectTasksMock.mockResolvedValue([]);
	getProjectsMock.mockResolvedValue([]);
});

describe("projectsQueryOptions", () => {
	it("keys the cache by the term and drops an empty one", () => {
		expect(projectsQueryOptions("redesign").queryKey).toEqual([
			"projects",
			{ q: "redesign" },
		]);
		expect(projectsQueryOptions("").queryKey).toEqual(["projects", {}]);
	});

	it("fetches through the api client with the term", async () => {
		const options = projectsQueryOptions("redesign");

		await (options.queryFn as () => Promise<unknown>)();

		expect(getProjectsMock).toHaveBeenCalledWith("redesign");
	});
});

describe("projectQueryOptions", () => {
	it("keys the cache by the id", () => {
		expect(projectQueryOptions(3).queryKey).toEqual(["project", { id: 3 }]);
		expect(projectQueryOptions(4).queryKey).not.toEqual(
			projectQueryOptions(3).queryKey,
		);
	});

	it("fetches one project through the api client", async () => {
		const options = projectQueryOptions(3);

		await (options.queryFn as () => Promise<unknown>)();

		expect(getProjectMock).toHaveBeenCalledWith(3);
	});
});

describe("projectTasksQueryOptions", () => {
	it("keys the cache by the project and every board filter", () => {
		expect(
			projectTasksQueryOptions(3, { status: "todo", cursor: "Y3Vyc29y" })
				.queryKey,
		).toEqual(["project-tasks", 3, { status: "todo", cursor: "Y3Vyc29y" }]);
	});

	it("drops absent board filters from the key, as the request does", () => {
		expect(projectTasksQueryOptions(3, {}).queryKey).toEqual([
			"project-tasks",
			3,
			{},
		]);
		expect(projectTasksQueryOptions(3).queryKey).toEqual([
			"project-tasks",
			3,
			{},
		]);
	});

	it("fetches the board page through the api client", async () => {
		const options = projectTasksQueryOptions(3, { status: "todo" });

		await (options.queryFn as () => Promise<unknown>)();

		expect(getProjectTasksMock).toHaveBeenCalledWith(3, { status: "todo" });
	});
});
