import { makeProject, makeTaskRow, makeUser } from "@tests/fixtures/builders";
import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import type { TasksPageData } from "./tasks-page";
import { TasksPage } from "./tasks-page";

// The page's presentational composition over the data bag the route computes:
// heading, filter bar, table, summary line, pagination. The data-fetching
// wiring lives in the route and is covered end-to-end.

/** A full page bag, with the parts a test cares about overridable. */
function makePageData(overrides: Partial<TasksPageData> = {}): TasksPageData {
	return {
		rows: [],
		projects: [makeProject()],
		people: [makeUser()],
		size: 10,
		filtered: false,
		hasMore: false,
		onLaterPage: false,
		firstSearch: {},
		nextSearch: {},
		range: { from: 0, to: 0, total: 0 },
		filters: {
			search: "",
			status: "",
			projectId: undefined,
			assigneeId: undefined,
		},
		...overrides,
	};
}

describe("TasksPage", () => {
	it("shows the All tasks heading and page copy", () => {
		renderWithRouter(<TasksPage data={makePageData()} />);

		expect(
			screen.getByRole("heading", { name: "All tasks", level: 1 }),
		).toBeVisible();
		expect(
			screen.getByText("A workspace-wide view of tasks across every project."),
		).toBeVisible();
	});

	it("offers the new-task action the reference page has", () => {
		renderWithRouter(<TasksPage data={makePageData()} />);

		expect(screen.getByRole("link", { name: "＋ New task" })).toHaveAttribute(
			"href",
			"/tasks/new",
		);
	});

	it("shows the summary line built from the count aggregate", () => {
		renderWithRouter(
			<TasksPage
				data={makePageData({
					rows: [
						makeTaskRow({ id: 1 }),
						makeTaskRow({ id: 2 }),
						makeTaskRow({ id: 3 }),
					],
					range: { from: 1, to: 3, total: 3 },
				})}
			/>,
		);

		expect(screen.getByText("Showing 1-3 of 3 tasks")).toBeVisible();
	});

	it("suffices the summary line when a filter is applied", () => {
		renderWithRouter(
			<TasksPage
				data={makePageData({
					filtered: true,
					range: { from: 1, to: 1, total: 1 },
				})}
			/>,
		);

		expect(
			screen.getByText("Showing 1-1 of 1 task matching your filters"),
		).toBeVisible();
	});

	it("shows a filter bar seeded with the projects and people", () => {
		renderWithRouter(<TasksPage data={makePageData()} />);

		expect(
			screen.getByRole("searchbox", { name: "Search tasks" }),
		).toBeVisible();
		expect(screen.getByRole("combobox", { name: "Project" })).toBeVisible();
		expect(screen.getByRole("combobox", { name: "Status" })).toBeVisible();
		expect(screen.getByRole("combobox", { name: "Assignee" })).toBeVisible();
	});

	it("lists the tasks it is given", () => {
		const task = makeTaskRow({ title: "Listed Task" });

		renderWithRouter(<TasksPage data={makePageData({ rows: [task] })} />);

		expect(screen.getByText(task.title)).toBeVisible();
	});

	it("shows the empty state when there are no tasks", () => {
		renderWithRouter(<TasksPage data={makePageData()} />);

		expect(screen.getByText("No tasks match these filters.")).toBeVisible();
	});
});
