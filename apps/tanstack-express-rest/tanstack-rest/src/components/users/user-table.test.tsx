import { describe, it, expect } from "vitest";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { makeUser } from "@tests/fixtures/builders";
import { UserTable } from "./user-table";

describe("UserTable", () => {
	it("renders a row per person", () => {
		const people = [makeUser({ id: 1 }), makeUser({ id: 2 })];

		renderWithRouter(<UserTable people={people} />);

		expect(screen.getAllByRole("row")).toHaveLength(people.length + 1);
	});

	it("links each person to their detail page", () => {
		const person = makeUser({ id: 3, name: "Linked Person" });

		renderWithRouter(<UserTable people={[person]} />);

		const row = screen.getByRole("row", { name: new RegExp(person.name) });

		// The detail route is out of scope for this slice, so the link is a
		// plain anchor until /users/$id lands; the href contract is the same.
		expect(
			within(row).getByRole("link", { name: new RegExp(person.name) }),
		).toHaveAttribute("href", `/users/${person.id}`);
	});

	it("shows the email alongside the name", () => {
		const person = makeUser({
			name: "Emailed Person",
			email: "person@example.test",
		});

		renderWithRouter(<UserTable people={[person]} />);

		const row = screen.getByRole("row", { name: new RegExp(person.name) });

		expect(within(row).getByText(person.email)).toBeInTheDocument();
	});

	it("shows the three count columns", () => {
		// Distinct values so each figure is individually assertable.
		const person = makeUser({
			assignedTaskCount: 7,
			openTaskCount: 3,
			commentCount: 1,
		});

		renderWithRouter(<UserTable people={[person]} />);

		const row = screen.getByRole("row", { name: new RegExp(person.name) });

		expect(
			within(row).getByRole("cell", { name: String(person.assignedTaskCount) }),
		).toBeInTheDocument();
		expect(
			within(row).getByRole("cell", { name: String(person.openTaskCount) }),
		).toBeInTheDocument();
		expect(
			within(row).getByRole("cell", { name: String(person.commentCount) }),
		).toBeInTheDocument();
	});

	it("shows an empty state when there are no people", () => {
		renderWithRouter(<UserTable people={[]} />);

		expect(
			screen.getByText("No people in this workspace."),
		).toBeInTheDocument();
	});
});
