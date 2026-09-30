import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DashboardProjects } from "./dashboard-projects";
import type { DashboardProject } from "@/lib/types";

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

    render(<DashboardProjects projects={projects} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(projects.length);
  });

  it("links each card to its project", () => {
    const project = makeDashboardProject({ id: 12 });

    render(<DashboardProjects projects={[project]} />);

    expect(
      screen.getByRole("link", { name: new RegExp(project.name) }),
    ).toHaveAttribute("href", `/projects/${project.id}`);
  });

  it("shows the description in the accessible name", () => {
    const project = makeDashboardProject({
      description: "Distinct description",
    });

    render(<DashboardProjects projects={[project]} />);

    expect(
      screen.getByRole("link", { name: new RegExp(project.name) }),
    ).toHaveAccessibleName(new RegExp(project.description));
  });

  it("shows the task, open and people counts", () => {
    // Distinct values so each figure is individually assertable.
    const project = makeDashboardProject({
      taskCount: 7,
      openTaskCount: 5,
      peopleCount: 3,
    });

    render(<DashboardProjects projects={[project]} />);

    const card = screen.getByRole("link", { name: new RegExp(project.name) });

    expect(
      within(card).getByText(String(project.taskCount)),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(String(project.openTaskCount)),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(String(project.peopleCount)),
    ).toBeInTheDocument();
  });
});
