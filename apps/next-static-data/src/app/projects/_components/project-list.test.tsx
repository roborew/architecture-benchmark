import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProjectList } from "./project-list";
import { makeProject } from "@/test/fixtures";

describe("ProjectList", () => {
  it("renders a row for each project", () => {
    const project = makeProject({ id: 5, name: "Solo project" });

    render(<ProjectList projects={[project]} />);

    expect(screen.getAllByRole("row")).toHaveLength(2); // + header
  });

  it("shows the project name and description", () => {
    const project = makeProject({
      name: "Named project",
      description: "Its description",
    });

    render(<ProjectList projects={[project]} />);

    const row = screen.getByRole("row", { name: new RegExp(project.name) });

    expect(within(row).getByText(project.name)).toBeInTheDocument();
    expect(within(row).getByText(project.description)).toBeInTheDocument();
  });

  it("shows the task and open task counts", () => {
    // Distinct values so each figure is individually assertable.
    const project = makeProject({ taskCount: 7, openTaskCount: 3 });

    render(<ProjectList projects={[project]} />);

    const row = screen.getByRole("row", { name: new RegExp(project.name) });

    expect(
      within(row).getByRole("cell", { name: String(project.taskCount) }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("cell", { name: String(project.openTaskCount) }),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no projects", () => {
    render(<ProjectList projects={[]} />);

    expect(screen.getByText("No projects yet.")).toBeInTheDocument();
  });
});
