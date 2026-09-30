import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProjectDetail } from "./project-detail";
import { makeProject, makeTaskWithProject } from "@/test/fixtures";

const project = makeProject({
  id: 3,
  name: "Fixture project",
  description: "A project used only by unit tests.",
  taskCount: 4,
  openTaskCount: 3,
  peopleCount: 2,
});

const tasks = [
  makeTaskWithProject({ id: 11, title: "First task", status: "in progress" }),
  makeTaskWithProject({ id: 12, title: "Second task", status: "done" }),
];

describe("ProjectDetail", () => {
  it("shows the project name and description", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    expect(
      screen.getByRole("heading", { name: project.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(project.description)).toBeInTheDocument();
  });

  it("renders the three summary counts", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText(String(project.taskCount))).toBeInTheDocument();
    expect(screen.getByText(String(project.openTaskCount))).toBeInTheDocument();
    expect(screen.getByText(String(project.peopleCount))).toBeInTheDocument();
  });

  it("reuses the shared task table without the project column", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    // The project is already implied by the page, so only Comments is
    // the optional column here.
    expect(
      screen.getByRole("columnheader", { name: "Comments" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Project" }),
    ).not.toBeInTheDocument();
  });

  it("renders a row per task", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    expect(screen.getAllByRole("row")).toHaveLength(tasks.length + 1);
  });

  it("humanises each task status", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    const first = screen.getByRole("row", { name: /First task/ });
    const second = screen.getByRole("row", { name: /Second task/ });

    expect(within(first).getByText("In progress")).toBeInTheDocument();
    expect(within(second).getByText("Done")).toBeInTheDocument();
  });

  it("links each task to its detail page", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    const row = screen.getByRole("row", { name: /First task/ });

    expect(
      within(row).getByRole("link", { name: "First task" }),
    ).toHaveAttribute("href", "/tasks/11");
  });

  it("offers a task search field and status filter", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    expect(
      screen.getByRole("searchbox", { name: "Search tasks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Status" }),
    ).toBeInTheDocument();
  });

  it("shows an empty state when the project has no tasks", () => {
    render(<ProjectDetail project={project} tasks={[]} />);

    expect(
      screen.getByText("No tasks in this project yet."),
    ).toBeInTheDocument();
  });
});
