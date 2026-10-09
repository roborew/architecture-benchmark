import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TaskTable } from "./task-table";
import { makeTaskWithProject } from "@tests/fixtures/builders";

describe("TaskTable", () => {
  it("renders a row per task", () => {
    const tasks = [
      makeTaskWithProject({ id: 1 }),
      makeTaskWithProject({ id: 2 }),
      makeTaskWithProject({ id: 3 }),
    ];

    render(<TaskTable tasks={tasks} showProject showComments />);

    expect(screen.getAllByRole("row")).toHaveLength(tasks.length + 1);
  });

  it("links each task to its detail page", () => {
    const task = makeTaskWithProject({ id: 77, title: "Write the thing" });

    render(<TaskTable tasks={[task]} showProject showComments />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByRole("link", { name: task.title })).toHaveAttribute(
      "href",
      `/tasks/${task.id}`,
    );
  });

  it("shows the task id under the title", () => {
    const task = makeTaskWithProject({ id: 55 });

    render(<TaskTable tasks={[task]} showProject showComments />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByText(`#${task.id}`)).toBeInTheDocument();
  });

  it("renders the project column when requested", () => {
    const task = makeTaskWithProject({ projectName: "Alpha" });

    render(<TaskTable tasks={[task]} showProject showComments />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByText(task.projectName)).toBeInTheDocument();
  });

  it("omits the project column when not requested", () => {
    render(<TaskTable tasks={[makeTaskWithProject()]} showComments />);

    expect(
      screen.queryByRole("columnheader", { name: "Project" }),
    ).not.toBeInTheDocument();
  });

  it("omits the comments column when not requested", () => {
    render(<TaskTable tasks={[makeTaskWithProject()]} showProject />);

    expect(
      screen.queryByRole("columnheader", { name: "Comments" }),
    ).not.toBeInTheDocument();
  });

  it("shows comment counts when requested", () => {
    const task = makeTaskWithProject({ commentCount: 4 });

    render(<TaskTable tasks={[task]} showProject showComments />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(
      within(row).getByText(String(task.commentCount)),
    ).toBeInTheDocument();
  });

  it("renders the raw stored status text", () => {
    const tasks = [
      makeTaskWithProject({ id: 1, title: "Todo task", status: "todo" }),
      makeTaskWithProject({
        id: 2,
        title: "In flight task",
        status: "in progress",
      }),
      makeTaskWithProject({ id: 3, title: "Finished task", status: "done" }),
    ];

    render(<TaskTable tasks={tasks} showProject showComments />);

    expect(
      within(screen.getByRole("row", { name: /Todo task/ })).getByTestId(
        "task-status",
      ),
    ).toHaveTextContent("todo");
    expect(
      within(screen.getByRole("row", { name: /In flight task/ })).getByTestId(
        "task-status",
      ),
    ).toHaveTextContent("in progress");
    expect(
      within(screen.getByRole("row", { name: /Finished task/ })).getByTestId(
        "task-status",
      ),
    ).toHaveTextContent("done");
  });

  it("tags each row and its title, status and assignee cells", () => {
    const task = makeTaskWithProject({
      id: 42,
      title: "Tagged task",
      assigneeName: "Robin Andrew",
    });

    render(<TaskTable tasks={[task]} showProject showComments />);

    const row = screen.getByTestId("task-row");

    expect(within(row).getByTestId("task-title")).toHaveTextContent(
      "Tagged task",
    );
    expect(within(row).getByTestId("task-assignee")).toHaveTextContent(
      "Robin Andrew",
    );
  });

  it("shows an empty state when there are no tasks", () => {
    render(<TaskTable tasks={[]} showProject showComments />);

    expect(
      screen.getByText("No tasks match these filters."),
    ).toBeInTheDocument();
  });
});
