import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProjectDetail } from "./project-detail";
import { makeProject, makeTask } from "@/test/fixtures";

describe("ProjectDetail", () => {
  it("shows the project name and description", () => {
    const project = makeProject({
      name: "Detail project",
      description: "Detail description",
    });

    render(<ProjectDetail project={project} tasks={[]} />);

    expect(
      screen.getByRole("heading", { name: project.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(project.description)).toBeInTheDocument();
  });

  it("renders summary counts", () => {
    render(<ProjectDetail project={makeProject()} tasks={[]} />);

    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
  });

  it("renders a row per task", () => {
    const task = makeTask({
      id: 4242,
      title: "Detail task",
      status: "in progress",
      assigneeName: "Detail Person",
    });

    render(<ProjectDetail project={makeProject()} tasks={[task]} />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByText("In progress")).toBeInTheDocument();
    expect(within(row).getByText(task.assigneeName)).toBeInTheDocument();
    expect(within(row).getByText(String(task.id))).toBeInTheDocument();
  });

  it("shows an empty state when the project has no tasks", () => {
    render(<ProjectDetail project={makeProject()} tasks={[]} />);

    expect(
      screen.getByText("No tasks in this project yet."),
    ).toBeInTheDocument();
  });
});
