import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProjectList } from "./project-list";
import { makeProject } from "@/test/fixtures";

describe("ProjectList", () => {
  it("renders a row for each project plus a header", () => {
    const projects = [makeProject({ id: 1 }), makeProject({ id: 2 })];

    render(<ProjectList projects={projects} />);

    expect(screen.getAllByRole("row")).toHaveLength(projects.length + 1);
  });

  it("links the project name to its detail page", () => {
    const project = makeProject({ id: 7, name: "Linked project" });

    render(<ProjectList projects={[project]} />);

    const row = screen.getByRole("row", { name: new RegExp(project.name) });

    expect(
      within(row).getByRole("link", { name: project.name }),
    ).toHaveAttribute("href", `/projects/${project.id}`);
  });

  it("shows the description under the project name", () => {
    const project = makeProject({
      name: "Described",
      description: "Its description",
    });

    render(<ProjectList projects={[project]} />);

    const row = screen.getByRole("row", { name: /Described/ });

    expect(within(row).getByText(project.description)).toBeInTheDocument();
  });

  it("shows the task, open and created columns", () => {
    const project = makeProject({
      taskCount: 7,
      openTaskCount: 3,
      createdAt: "2026-09-27",
    });

    render(<ProjectList projects={[project]} />);

    const row = screen.getByRole("row", { name: new RegExp(project.name) });

    expect(
      within(row).getByRole("cell", { name: String(project.taskCount) }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("cell", { name: String(project.openTaskCount) }),
    ).toBeInTheDocument();
    expect(within(row).getByText("27 Sep 2026")).toBeInTheDocument();
  });

  it("exposes the reference column headers", () => {
    render(<ProjectList projects={[makeProject()]} />);

    ["Project", "Tasks", "Open", "Created"].forEach((header) => {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    });
  });

  it("shows an empty state when there are no projects", () => {
    render(<ProjectList projects={[]} />);

    expect(screen.getByText("No projects yet.")).toBeInTheDocument();
  });
});
