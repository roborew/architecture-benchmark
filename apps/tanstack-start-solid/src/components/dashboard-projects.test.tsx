import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import type { DashboardProject } from "@/lib/types";
import { DashboardProjects } from "./dashboard-projects";

function makeDashboardProject(
	overrides: Partial<DashboardProject> = {},
): DashboardProject {
	return {
		id: 9401,
		name: "Fixture card project",
		description: "A card used only by unit tests.",
		taskCount: 5,
		openTaskCount: 4,
		peopleCount: 3,
		...overrides,
	};
}

describe("DashboardProjects", () => {
	it("renders a card per project", () => {
		const projects = [
			makeDashboardProject({ id: 1 }),
			makeDashboardProject({ id: 2 }),
		];

		renderWithRouter(() => <DashboardProjects projects={projects} />);

		expect(screen.getAllByRole("listitem")).toHaveLength(projects.length);
	});

	it("links each card to its project", () => {
		const project = makeDashboardProject({ id: 12 });

		renderWithRouter(() => <DashboardProjects projects={[project]} />);

		expect(
			screen.getByRole("link", { name: new RegExp(project.name) }),
		).toHaveAttribute("href", `/projects/${project.id}`);
	});

	it("shows the description in the accessible name", () => {
		const project = makeDashboardProject({
			description: "Distinct description",
		});

		renderWithRouter(() => <DashboardProjects projects={[project]} />);

		expect(
			screen.getByRole("link", { name: new RegExp(project.name) }),
		).toHaveAccessibleName(new RegExp(project.description));
	});

	it("shows the task, open and people counts", () => {
		const project = makeDashboardProject({
			taskCount: 7,
			openTaskCount: 5,
			peopleCount: 3,
		});

		renderWithRouter(() => <DashboardProjects projects={[project]} />);

		const card = screen.getByRole("link", { name: new RegExp(project.name) });

		expect(screen.getByText(String(project.taskCount))).toBeInTheDocument();
		expect(screen.getByText(String(project.openTaskCount))).toBeInTheDocument();
		expect(screen.getByText(String(project.peopleCount))).toBeInTheDocument();
	});
});
