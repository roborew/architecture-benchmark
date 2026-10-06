import { makeTaskWithProject, makeUser } from "@tests/fixtures/builders";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { describe, expect, it, vi } from "vitest";
import { UserDetail } from "./user-detail";

vi.mock("@/lib/actions", () => ({
	deleteUser: vi.fn(async () => ({})),
}));

describe("UserDetail", () => {
	it("shows the person's name and email", () => {
		const person = makeUser({
			name: "Detail Person",
			email: "detail@example.test",
		});

		renderWithRouter(() => <UserDetail person={person} tasks={[]} />);

		expect(
			screen.getByRole("heading", { name: person.name }),
		).toBeInTheDocument();
		expect(screen.getByText(person.email)).toBeInTheDocument();
	});

	it("renders the summary counts", () => {
		const person = makeUser({ assignedTaskCount: 7, commentCount: 4 });

		renderWithRouter(() => <UserDetail person={person} tasks={[]} />);

		expect(screen.getAllByText("Assigned tasks")).toHaveLength(2);
		expect(screen.getByText("Comments authored")).toBeInTheDocument();
		expect(
			screen.getByText(String(person.assignedTaskCount)),
		).toBeInTheDocument();
		expect(screen.getByText(String(person.commentCount))).toBeInTheDocument();
	});

	it("reuses the shared task table with the project column only", () => {
		const task = makeTaskWithProject({
			title: "Assigned task",
			projectName: "Alpha",
			status: "in progress",
		});

		renderWithRouter(() => <UserDetail person={makeUser()} tasks={[task]} />);

		expect(
			screen.getByRole("columnheader", { name: "Project" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("columnheader", { name: "Comments" }),
		).not.toBeInTheDocument();
		expect(
			within(screen.getByRole("row", { name: /Assigned task/ })).getByText(
				"In progress",
			),
		).toBeInTheDocument();
	});

	it("links each assigned task to its detail page", () => {
		const task = makeTaskWithProject({ id: 88, title: "Linked task" });

		renderWithRouter(() => <UserDetail person={makeUser()} tasks={[task]} />);

		const row = screen.getByRole("row", { name: new RegExp(task.title) });

		expect(within(row).getByRole("link", { name: task.title })).toHaveAttribute(
			"href",
			`/tasks/${task.id}`,
		);
	});

	it("shows an empty state when the person has no assigned tasks", () => {
		renderWithRouter(() => <UserDetail person={makeUser()} tasks={[]} />);

		expect(
			screen.getByText("No tasks are assigned to this person."),
		).toBeInTheDocument();
	});

	it("offers an edit link to this member's own edit page", () => {
		renderWithRouter(() => (
			<UserDetail person={makeUser({ id: 12 })} tasks={[]} />
		));

		expect(screen.getByRole("link", { name: "Edit user" })).toHaveAttribute(
			"href",
			"/users/12/edit",
		);
	});

	it("offers a delete control naming the member", () => {
		renderWithRouter(() => (
			<UserDetail
				person={makeUser({ id: 12, name: "Ada Lovelace" })}
				tasks={[]}
			/>
		));

		expect(
			screen.getByRole("button", { name: /Delete Ada Lovelace/ }),
		).toBeInTheDocument();
	});
});
