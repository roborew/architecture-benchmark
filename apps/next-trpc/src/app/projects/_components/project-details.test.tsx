import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProjectDetail } from "./project-detail";
import { makeProject, makeProjectTaskRow } from "@tests/fixtures/builders";

const project = makeProject({
  id: 3,
  name: "Fixture project",
  description: "A project used only by unit tests.",
  taskCount: 4,
  openTaskCount: 3,
  peopleCount: 2,
});

const tasks = [
  makeProjectTaskRow({ id: 11, title: "First task", status: "in progress" }),
  makeProjectTaskRow({ id: 12, title: "Second task", status: "done" }),
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

  it("renders the raw stored status text", () => {
    // spec/contract.md requires the raw stored value, not a display label; the
    // capitalised look comes from CSS.
    render(<ProjectDetail project={project} tasks={tasks} />);

    const first = screen.getByRole("row", { name: /First task/ });
    const second = screen.getByRole("row", { name: /Second task/ });

    expect(within(first).getByTestId("task-status")).toHaveTextContent(
      "in progress",
    );
    expect(within(second).getByTestId("task-status")).toHaveTextContent("done");
  });

  it("links each task to its detail page", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    const row = screen.getByRole("row", { name: /First task/ });

    expect(
      within(row).getByRole("link", { name: "First task" }),
    ).toHaveAttribute("href", "/tasks/11");
  });

  it("offers a task search field and the status filter tabs", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    expect(
      screen.getByRole("searchbox", { name: "Search tasks" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("status-filter")).toHaveLength(4);
  });

  it("marks the active status tab so the filter shows what is applied", () => {
    render(<ProjectDetail project={project} tasks={tasks} status="todo" />);

    const todoTab = screen
      .getAllByTestId("status-filter")
      .find((tab) => tab.getAttribute("data-status") === "todo");

    expect(todoTab).toHaveAttribute("aria-current", "page");
  });

  it("carries the raw stored status in each tab's data-status and href", () => {
    render(<ProjectDetail project={project} tasks={tasks} />);

    const tabs = screen.getAllByTestId("status-filter");

    expect(tabs.map((tab) => tab.getAttribute("data-status"))).toEqual([
      "all",
      "todo",
      "in progress",
      "done",
    ]);

    const inProgress = tabs.find(
      (tab) => tab.getAttribute("data-status") === "in progress",
    );
    expect(inProgress).toHaveAttribute(
      "href",
      `/projects/${project.id}?status=in%20progress`,
    );

    const all = tabs.find((tab) => tab.getAttribute("data-status") === "all");
    expect(all).toHaveAttribute("href", `/projects/${project.id}`);
  });

  it("marks the all tab active when no status is selected", () => {
    render(<ProjectDetail project={project} tasks={tasks} status="" />);

    const allTab = screen
      .getAllByTestId("status-filter")
      .find((tab) => tab.getAttribute("data-status") === "all");

    expect(allTab).toHaveAttribute("aria-current", "page");
  });

  it("shows an empty state when the project has no tasks", () => {
    render(<ProjectDetail project={project} tasks={[]} />);

    expect(
      screen.getByText("No tasks in this project yet."),
    ).toBeInTheDocument();
  });

  it("offers no older link when the page came back short of a full page", () => {
    // A short page means the query ran out of rows, so there is nothing older
    // to link to and offering one would dead-end the reader.
    render(<ProjectDetail project={project} tasks={tasks} hasMore={false} />);

    expect(screen.queryByTestId("next-page")).not.toBeInTheDocument();
  });

  it("links to the next page using the last row's cursor", () => {
    render(
      <ProjectDetail
        project={project}
        tasks={tasks.map((task) => ({
          ...task,
          cursorFor: `cursor-${task.id}`,
        }))}
        hasMore
      />,
    );

    // The cursor comes from the *last* row on the page: the next page starts
    // after it, not after the first row.
    expect(screen.getByTestId("next-page")).toHaveAttribute(
      "href",
      `/projects/${project.id}?cursor=cursor-${tasks[tasks.length - 1].id}`,
    );
  });

  it("carries the active status filter onto the older link", () => {
    // Dropping it would silently reset the filter on the next page while the
    // select still shows it selected.
    render(
      <ProjectDetail
        project={project}
        tasks={tasks.map((task) => ({ ...task, cursorFor: "cursor-1" }))}
        status="done"
        hasMore
      />,
    );

    expect(screen.getByTestId("next-page")).toHaveAttribute(
      "href",
      `/projects/${project.id}?status=done&cursor=cursor-1`,
    );
  });

  it("shows no older link when the page has no rows to continue from", () => {
    render(<ProjectDetail project={project} tasks={[]} hasMore />);

    expect(screen.queryByTestId("next-page")).not.toBeInTheDocument();
  });
});
