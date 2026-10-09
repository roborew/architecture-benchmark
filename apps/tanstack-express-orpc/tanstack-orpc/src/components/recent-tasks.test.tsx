import { makeRecentTask } from "@tests/fixtures/builders";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { RecentTasks } from "./recent-tasks";

// The dashboard's recent-activity table: a row per recent task, each linking
// to its detail page and carrying its project, status, assignee and updated
// timestamp.

describe("RecentTasks", () => {
	it("renders a row per task", () => {
		const tasks = [
			makeRecentTask({ id: 1, title: "A" }),
			makeRecentTask({ id: 2, title: "B" }),
			makeRecentTask({ id: 3, title: "C" }),
		];

		renderWithRouter(<RecentTasks tasks={tasks} />);

		expect(screen.getAllByRole("row")).toHaveLength(tasks.length + 1);
	});

	it("links each task by title and shows its project", () => {
		const task = makeRecentTask({
			id: 88,
			title: "Link me",
			projectName: "Alpha",
		});

		renderWithRouter(<RecentTasks tasks={[task]} />);

		const row = screen.getByRole("row", { name: new RegExp(task.title) });

		expect(within(row).getByRole("link", { name: task.title })).toHaveAttribute(
			"href",
			`/tasks/${task.id}`,
		);
		expect(within(row).getByText(task.projectName)).toBeInTheDocument();
	});

	it("renders each status as its raw stored value", () => {
		const tasks = [
			makeRecentTask({ id: 1, title: "Todo task", status: "in progress" }),
			makeRecentTask({ id: 2, title: "To do task", status: "todo" }),
			makeRecentTask({ id: 3, title: "Done task", status: "done" }),
		];

		renderWithRouter(<RecentTasks tasks={tasks} />);

		// spec/contract.md: the raw value, not a JS-mapped label.
		expect(
			within(screen.getByRole("row", { name: /Todo task/ })).getByText(
				"in progress",
			),
		).toBeInTheDocument();
		expect(
			within(screen.getByRole("row", { name: /To do task/ })).getByText("todo"),
		).toBeInTheDocument();
		expect(
			within(screen.getByRole("row", { name: /Done task/ })).getByText("done"),
		).toBeInTheDocument();
	});

	it("shows assignee and updated columns", () => {
		const task = makeRecentTask({
			assigneeName: "Assignee Person",
			updatedAt: "Some day",
		});

		renderWithRouter(<RecentTasks tasks={[task]} />);

		const row = screen.getByRole("row", { name: new RegExp(task.title) });

		expect(within(row).getByText(task.assigneeName)).toBeInTheDocument();
		expect(within(row).getByText(task.updatedAt)).toBeInTheDocument();
	});

	it("shows an empty state when there are no recent tasks", () => {
		renderWithRouter(<RecentTasks tasks={[]} />);

		expect(screen.getByText("No recent task activity.")).toBeInTheDocument();
	});
});
