import { dashboardStats } from "@tests/fixtures/data";
import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { DashboardStats } from "./dashboard-stats";

describe("DashboardStats", () => {
	it("shows a card per workspace metric", () => {
		renderWithRouter(() => <DashboardStats stats={dashboardStats} />);

		expect(screen.getByText("Projects")).toBeInTheDocument();
		expect(screen.getByText("Total tasks")).toBeInTheDocument();
		expect(screen.getByText("Open tasks")).toBeInTheDocument();
		expect(screen.getByText("People")).toBeInTheDocument();
	});

	it("renders the seeded counts", () => {
		renderWithRouter(() => <DashboardStats stats={dashboardStats} />);

		expect(screen.getByText("Workspace projects")).toBeInTheDocument();
		expect(screen.getByText("Across all projects")).toBeInTheDocument();
		expect(screen.getByText("To do and in progress")).toBeInTheDocument();
		expect(screen.getByText("Workspace members")).toBeInTheDocument();
	});
});
