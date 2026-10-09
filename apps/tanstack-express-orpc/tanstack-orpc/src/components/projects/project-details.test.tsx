import { makeProject, makeProjectTaskRow } from "@tests/fixtures/builders";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";

import { ProjectDetail } from "./project-detail";

// One project's board: the header counts, the status filter form, the task
// table, and the keyset "older" link carrying the last row's cursor.

const project = makeProject({
	id: 3,
	name: "Fixture project",
	description: "A project used only by unit tests.",
	taskCount: 4,
	openTaskCount: 3,
	peopleCount: 2,
});

const tasks = [
	makeProjectTaskRow({ id: 11, title: "First task", status: "in progress" }),
	makeProjectTaskRow({ id: 12, title: "Second task", status: "done" }),
];

/** The status-filter tab carrying a given raw `data-status`. */
function statusTab(status: string) {
	const tab = screen
		.getAllByTestId("status-filter")
		.find((element) => element.getAttribute("data-status") === status);

	if (!tab) throw new Error(`No status-filter tab for ${status}`);

	return tab;
}

describe("ProjectDetail", () => {
	it("shows the project name and description", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		expect(
			screen.getByRole("heading", { name: project.name }),
		).toBeInTheDocument();
		expect(screen.getByText(project.description)).toBeInTheDocument();
	});

	it("renders the three summary counts", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		expect(screen.getByText("Tasks")).toBeInTheDocument();
		expect(screen.getByText("Open")).toBeInTheDocument();
		expect(screen.getByText("People")).toBeInTheDocument();
		expect(screen.getByText(String(project.taskCount))).toBeInTheDocument();
		expect(screen.getByText(String(project.openTaskCount))).toBeInTheDocument();
		expect(screen.getByText(String(project.peopleCount))).toBeInTheDocument();
	});

	it("reuses the shared task table without the project column", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		// The project is already implied by the page, so only Comments is
		// the optional column here.
		expect(
			screen.getByRole("columnheader", { name: "Comments" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("columnheader", { name: "Project" }),
		).not.toBeInTheDocument();
	});

	it("renders a row per task", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		expect(screen.getAllByRole("row")).toHaveLength(tasks.length + 1);
	});

	it("renders each task status as its raw stored value", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		const first = screen.getByRole("row", { name: /First task/ });
		const second = screen.getByRole("row", { name: /Second task/ });

		// spec/contract.md: the raw value, not a JS-mapped label.
		expect(within(first).getByTestId("task-status")).toHaveTextContent(
			"in progress",
		);
		expect(within(second).getByTestId("task-status")).toHaveTextContent("done");
	});

	it("tags each row, title and assignee with its contract testid", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		const first = screen.getByRole("row", { name: /First task/ });

		expect(within(first).getByTestId("task-title")).toHaveTextContent(
			"First task",
		);
		expect(within(first).getByTestId("task-assignee")).toHaveTextContent(
			tasks[0].assigneeName,
		);
	});

	it("links each task to its detail page", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		const row = screen.getByRole("row", { name: /First task/ });

		expect(
			within(row).getByRole("link", { name: "First task" }),
		).toHaveAttribute("href", "/tasks/11");
	});

	it("gives each status tab the raw data-status, not TanStack's active marker", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		// Plain <a> links, so `data-status` stays the contract value; a TanStack
		// <Link> would overwrite it with "active"/"inactive".
		expect(
			screen
				.getAllByTestId("status-filter")
				.map((tab) => tab.getAttribute("data-status")),
		).toEqual(["all", "todo", "in progress", "done"]);
	});

	it("links each status tab to the board with the raw stored status", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		expect(statusTab("done")).toHaveAttribute(
			"href",
			`/projects/${project.id}?status=done`,
		);
		// The raw stored spelling, URL-encoded — the route accepts it.
		expect(statusTab("in progress")).toHaveAttribute(
			"href",
			`/projects/${project.id}?status=in%20progress`,
		);
		// `all` clears the filter, so it is the bare board URL.
		expect(statusTab("all")).toHaveAttribute("href", `/projects/${project.id}`);
	});

	it("marks the active status so the filter shows what is applied", () => {
		renderWithRouter(
			<ProjectDetail project={project} tasks={tasks} status="todo" />,
		);

		expect(statusTab("todo")).toHaveAttribute("aria-current", "page");
		expect(statusTab("all")).not.toHaveAttribute("aria-current");
	});

	it("accepts the raw in progress spelling as the in progress tab", () => {
		renderWithRouter(
			<ProjectDetail project={project} tasks={tasks} status="in progress" />,
		);

		expect(statusTab("in progress")).toHaveAttribute("aria-current", "page");
	});

	it("marks all as active when no status is selected", () => {
		renderWithRouter(
			<ProjectDetail project={project} tasks={tasks} status="" />,
		);

		expect(statusTab("all")).toHaveAttribute("aria-current", "page");
	});

	it("shows an empty state when the project has no tasks", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={[]} />);

		expect(
			screen.getByText("No tasks in this project yet."),
		).toBeInTheDocument();
	});

	it("offers no older link when the page came back short of a full page", () => {
		// A short page means the query ran out of rows, so there is nothing older
		// to link to and offering one would dead-end the reader.
		renderWithRouter(
			<ProjectDetail project={project} tasks={tasks} hasMore={false} />,
		);

		expect(screen.queryByTestId("next-page")).not.toBeInTheDocument();
	});

	it("links to the next page using the last row's cursor", () => {
		renderWithRouter(
			<ProjectDetail
				project={project}
				tasks={tasks.map((task) => ({
					...task,
					cursorFor: `cursor-${task.id}`,
				}))}
				hasMore
			/>,
		);

		// The cursor comes from the *last* row on the page: the next page starts
		// after it, not after the first row.
		expect(screen.getByTestId("next-page")).toHaveAttribute(
			"href",
			`/projects/${project.id}?cursor=cursor-${tasks[tasks.length - 1].id}`,
		);
	});

	it("carries the active status filter onto the older link", () => {
		// Dropping it would silently reset the filter on the next page while the
		// select still shows it selected.
		renderWithRouter(
			<ProjectDetail
				project={project}
				tasks={tasks.map((task) => ({ ...task, cursorFor: "cursor-1" }))}
				status="done"
				hasMore
			/>,
		);

		expect(screen.getByTestId("next-page")).toHaveAttribute(
			"href",
			`/projects/${project.id}?status=done&cursor=cursor-1`,
		);
	});

	it("shows no older link when the page has no rows to continue from", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={[]} hasMore />);

		expect(screen.queryByTestId("next-page")).not.toBeInTheDocument();
	});
});
