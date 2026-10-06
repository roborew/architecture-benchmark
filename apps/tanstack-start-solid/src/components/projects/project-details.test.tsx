import { makeProject, makeProjectTaskRow } from "@tests/fixtures/builders";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { ProjectDetail } from "./project-detail";

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
		renderWithRouter(() => <ProjectDetail project={project} tasks={tasks} />);

		expect(
			screen.getByRole("heading", { name: project.name }),
		).toBeInTheDocument();
		expect(screen.getByText(project.description)).toBeInTheDocument();
	});

	it("renders the three summary counts", () => {
		renderWithRouter(() => <ProjectDetail project={project} tasks={tasks} />);

		expect(screen.getByText("Tasks")).toBeInTheDocument();
		expect(screen.getByText("Open")).toBeInTheDocument();
		expect(screen.getByText("People")).toBeInTheDocument();
		expect(screen.getByText(String(project.taskCount))).toBeInTheDocument();
		expect(screen.getByText(String(project.openTaskCount))).toBeInTheDocument();
		expect(screen.getByText(String(project.peopleCount))).toBeInTheDocument();
	});

	it("reuses the shared task table without the project column", () => {
		renderWithRouter(() => <ProjectDetail project={project} tasks={tasks} />);

		expect(
			screen.getByRole("columnheader", { name: "Comments" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("columnheader", { name: "Project" }),
		).not.toBeInTheDocument();
	});

	it("renders a row per task", () => {
		renderWithRouter(() => <ProjectDetail project={project} tasks={tasks} />);

		expect(screen.getAllByRole("row")).toHaveLength(tasks.length + 1);
	});

	it("humanises each task status", () => {
		renderWithRouter(() => <ProjectDetail project={project} tasks={tasks} />);

		const first = screen.getByRole("row", { name: /First task/ });
		const second = screen.getByRole("row", { name: /Second task/ });

		expect(within(first).getByText("In progress")).toBeInTheDocument();
		expect(within(second).getByText("Done")).toBeInTheDocument();
	});

	it("links each task to its detail page", () => {
		renderWithRouter(() => <ProjectDetail project={project} tasks={tasks} />);

		const row = screen.getByRole("row", { name: /First task/ });

		expect(
			within(row).getByRole("link", { name: "First task" }),
		).toHaveAttribute("href", "/tasks/11");
	});

	it("offers a task search field and status filter", () => {
		renderWithRouter(() => <ProjectDetail project={project} tasks={tasks} />);

		expect(
			screen.getByRole("searchbox", { name: "Search tasks" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("combobox", { name: "Status" }),
		).toBeInTheDocument();
	});

	it("marks the active status so the filter shows what is applied", () => {
		renderWithRouter(() => (
			<ProjectDetail project={project} tasks={tasks} status="todo" />
		));

		expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue(
			"todo",
		);
	});

	it("shows the status filter as empty when no status is selected", () => {
		renderWithRouter(() => (
			<ProjectDetail project={project} tasks={tasks} status="" />
		));

		expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("");
	});

	it("shows an empty state when the project has no tasks", () => {
		renderWithRouter(() => <ProjectDetail project={project} tasks={[]} />);

		expect(
			screen.getByText("No tasks in this project yet."),
		).toBeInTheDocument();
	});

	it("offers no older link when the page came back short of a full page", () => {
		renderWithRouter(() => (
			<ProjectDetail project={project} tasks={tasks} hasMore={false} />
		));

		expect(screen.queryByTestId("next-page")).not.toBeInTheDocument();
	});

	it("links to the next page using the last row's cursor", () => {
		renderWithRouter(() => (
			<ProjectDetail
				project={project}
				tasks={tasks.map((task) => ({
					...task,
					cursorFor: `cursor-${task.id}`,
				}))}
				hasMore
			/>
		));

		expect(screen.getByTestId("next-page")).toHaveAttribute(
			"href",
			`/projects/${project.id}?cursor=cursor-${tasks[tasks.length - 1].id}`,
		);
	});

	it("carries the active status filter onto the older link", () => {
		renderWithRouter(() => (
			<ProjectDetail
				project={project}
				tasks={tasks.map((task) => ({ ...task, cursorFor: "cursor-1" }))}
				status="done"
				hasMore
			/>
		));

		expect(screen.getByTestId("next-page")).toHaveAttribute(
			"href",
			`/projects/${project.id}?status=done&cursor=cursor-1`,
		);
	});

	it("shows no older link when the page has no rows to continue from", () => {
		renderWithRouter(() => (
			<ProjectDetail project={project} tasks={[]} hasMore />
		));

		expect(screen.queryByTestId("next-page")).not.toBeInTheDocument();
	});
});
