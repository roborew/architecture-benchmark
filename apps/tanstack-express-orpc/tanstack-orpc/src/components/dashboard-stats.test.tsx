import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import type { DashboardStats as Stats } from "@/lib/types";
import { DashboardStats } from "./dashboard-stats";

// The dashboard's summary strip: one card per metric, each labelled and
// hinted so the numbers say what they counted.

const stats: Stats = {
	projectCount: 3,
	totalTasks: 6,
	openTasks: 5,
	peopleCount: 3,
	todoTasks: 3,
	inProgressTasks: 2,
	doneTasks: 1,
};

describe("DashboardStats", () => {
	it("shows a card per workspace metric", () => {
		renderWithRouter(<DashboardStats stats={stats} />);

		expect(screen.getByText("Projects")).toBeInTheDocument();
		expect(screen.getByText("Total tasks")).toBeInTheDocument();
		expect(screen.getByText("Open tasks")).toBeInTheDocument();
		expect(screen.getByText("People")).toBeInTheDocument();
	});

	it("renders the seeded counts", () => {
		renderWithRouter(<DashboardStats stats={stats} />);

		expect(screen.getByText("Workspace projects")).toBeInTheDocument();
		expect(screen.getByText("Across all projects")).toBeInTheDocument();
		expect(screen.getByText("To do and in progress")).toBeInTheDocument();
		expect(screen.getByText("Workspace members")).toBeInTheDocument();
	});
});
