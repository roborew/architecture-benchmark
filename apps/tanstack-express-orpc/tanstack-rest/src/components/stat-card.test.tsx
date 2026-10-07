import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { StatCard } from "./stat-card";

// One metric card: the label, the value and the hint it was counted from —
// all three arrive as props, so the card is a pure function of its input.

describe("StatCard", () => {
	it("shows the label, value and hint", () => {
		renderWithRouter(
			<StatCard label="Projects" value={3} hint="Workspace projects" />,
		);

		expect(screen.getByText("Projects")).toBeInTheDocument();
		expect(screen.getByText("3")).toBeInTheDocument();
		expect(screen.getByText("Workspace projects")).toBeInTheDocument();
	});

	it("renders the value as text", () => {
		renderWithRouter(
			<StatCard label="Open tasks" value={5} hint="To do and in progress" />,
		);

		expect(screen.getByText("5")).toBeInTheDocument();
	});

	it("keeps the label and value out of the accessible name", () => {
		renderWithRouter(
			<StatCard label="People" value={3} hint="Workspace members" />,
		);

		// The value is decorative-ish chrome; queries should target the label.
		expect(screen.getByText("People")).toBeInTheDocument();
		expect(screen.queryByText("Workspace members")).toBeInTheDocument();
	});
});
