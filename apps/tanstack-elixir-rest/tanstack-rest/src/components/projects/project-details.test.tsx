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

	it("renders the raw stored status", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		const first = screen.getByRole("row", { name: /First task/ });
		const second = screen.getByRole("row", { name: /Second task/ });

		// spec/contract.md: the raw stored value, not a JS-mapped label.
		expect(within(first).getByTestId("task-status")).toHaveTextContent(
			/^in progress$/,
		);
		expect(within(second).getByTestId("task-status")).toHaveTextContent(
			/^done$/,
		);
	});

	it("links each task to its detail page", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		const row = screen.getByRole("row", { name: /First task/ });

		expect(
			within(row).getByRole("link", { name: "First task" }),
		).toHaveAttribute("href", "/tasks/11");
	});

	it("offers a task search field and the status filter tabs", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		expect(
			screen.getByRole("searchbox", { name: "Search tasks" }),
		).toBeInTheDocument();

		const tabs = screen.getAllByTestId("status-filter");

		// One per status plus `all`, each carrying the raw stored spelling.
		expect(tabs.map((tab) => tab.getAttribute("data-status"))).toEqual([
			"all",
			"todo",
			"in progress",
			"done",
		]);
	});

	it("links each status tab to the filtered board", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		const hrefFor = (status: string) =>
			screen
				.getAllByTestId("status-filter")
				.find((tab) => tab.getAttribute("data-status") === status)
				?.getAttribute("href");

		// `all` clears the filter; the others carry the stored status with the
		// space in `in progress` URL-encoded.
		expect(hrefFor("all")).toBe(`/projects/${project.id}`);
		expect(hrefFor("todo")).toBe(`/projects/${project.id}?status=todo`);
		expect(hrefFor("in progress")).toBe(
			`/projects/${project.id}?status=in%20progress`,
		);
		expect(hrefFor("done")).toBe(`/projects/${project.id}?status=done`);
	});

	it("renders the status tabs as plain links carrying the raw data-status", () => {
		renderWithRouter(<ProjectDetail project={project} tasks={tasks} />);

		const tabs = screen.getAllByTestId("status-filter");

		// Not the router's `<Link>`, which would overwrite `data-status` with its
		// own active/inactive value.
		tabs.forEach((tab) => {
			expect(tab.tagName).toBe("A");
		});

		const doneTab = tabs.find(
			(tab) => tab.getAttribute("data-status") === "done",
		);

		expect(doneTab).toBeDefined();
		expect(doneTab?.tagName).toBe("A");
	});

	it("marks the active status tab so the filter shows what is applied", () => {
		renderWithRouter(
			<ProjectDetail project={project} tasks={tasks} status="todo" />,
		);

		const active = screen
			.getAllByTestId("status-filter")
			.filter((tab) => tab.getAttribute("aria-current") === "page");

		expect(active).toHaveLength(1);
		expect(active[0]).toHaveAttribute("data-status", "todo");
	});

	it("marks the all tab when no status is selected", () => {
		renderWithRouter(
			<ProjectDetail project={project} tasks={tasks} status="" />,
		);

		const active = screen
			.getAllByTestId("status-filter")
			.filter((tab) => tab.getAttribute("aria-current") === "page");

		expect(active).toHaveLength(1);
		expect(active[0]).toHaveAttribute("data-status", "all");
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
