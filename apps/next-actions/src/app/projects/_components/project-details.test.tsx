import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { projects, projectTasks } from "@/lib/seed-data";
import { ProjectDetail } from "./project-detail";

const project = projects[0];
const tasks = projectTasks[1];

describe("ProjectDetail", () => {
  it("shows the project name and description", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    expect(
      screen.getByRole("heading", { name: project.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(project.description)).toBeInTheDocument();
  });

  it("renders summary counts", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
  });

  it("renders a row per task", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    const row = screen.getByRole("row", { name: /Draft navigation model/ });

    expect(within(row).getByText("In progress")).toBeInTheDocument();
    expect(within(row).getByText("Robin Andrew")).toBeInTheDocument();
    expect(within(row).getByText("101")).toBeInTheDocument();
  });

  it("shows an empty state when the project has no tasks", () => {
    render(<ProjectDetail project={project} tasks={[]} />);

    expect(
      screen.getByText("No tasks in this project yet."),
    ).toBeInTheDocument();
  });
});
