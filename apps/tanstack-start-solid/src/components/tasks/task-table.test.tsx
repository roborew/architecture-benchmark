import { makeTaskWithProject } from "@tests/fixtures/builders";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { TaskTable } from "./task-table";

describe("TaskTable", () => {
  it("renders a row per task", () => {
    const tasks = [
      makeTaskWithProject({ id: 1 }),
      makeTaskWithProject({ id: 2 }),
      makeTaskWithProject({ id: 3 }),
    ];

    renderWithRouter(() => (
      <TaskTable tasks={tasks} showProject showComments />
    ));

    expect(screen.getAllByRole("row")).toHaveLength(tasks.length + 1);
  });

  it("links each task to its detail page", () => {
    const task = makeTaskWithProject({ id: 77, title: "Write the thing" });

    renderWithRouter(() => (
      <TaskTable tasks={[task]} showProject showComments />
    ));

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByRole("link", { name: task.title })).toHaveAttribute(
      "href",
      `/tasks/${task.id}`,
    );
  });

  it("shows the task id under the title", () => {
    const task = makeTaskWithProject({ id: 55 });

    renderWithRouter(() => (
      <TaskTable tasks={[task]} showProject showComments />
    ));

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByText(`#${task.id}`)).toBeInTheDocument();
  });

  it("renders the project column when requested", () => {
    const task = makeTaskWithProject({ projectName: "Alpha" });

    renderWithRouter(() => (
      <TaskTable tasks={[task]} showProject showComments />
    ));

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByText(task.projectName)).toBeInTheDocument();
  });

  it("omits the project column when not requested", () => {
    renderWithRouter(() => (
      <TaskTable tasks={[makeTaskWithProject()]} showComments />
    ));

    expect(
      screen.queryByRole("columnheader", { name: "Project" }),
    ).not.toBeInTheDocument();
  });

  it("omits the comments column when not requested", () => {
    renderWithRouter(() => (
      <TaskTable tasks={[makeTaskWithProject()]} showProject />
    ));

    expect(
      screen.queryByRole("columnheader", { name: "Comments" }),
    ).not.toBeInTheDocument();
  });

  it("shows comment counts when requested", () => {
    const task = makeTaskWithProject({ commentCount: 4 });

    renderWithRouter(() => (
      <TaskTable tasks={[task]} showProject showComments />
    ));

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(
      within(row).getByText(String(task.commentCount)),
    ).toBeInTheDocument();
  });

  it("renders the raw status text, not a js label", () => {
    const tasks = [
      makeTaskWithProject({ id: 1, title: "Todo task", status: "todo" }),
      makeTaskWithProject({
        id: 2,
        title: "In flight task",
        status: "in progress",
      }),
      makeTaskWithProject({ id: 3, title: "Finished task", status: "done" }),
    ];

    renderWithRouter(() => (
      <TaskTable tasks={tasks} showProject showComments />
    ));

    // spec/contract.md: the element carrying `task-status` holds the stored
    // value verbatim; capitalisation is CSS, so the text stays raw.
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

  it("marks each row, title and assignee with the contract testids", () => {
    const task = makeTaskWithProject({
      id: 42,
      title: "Tagged task",
      assigneeName: "Tagged Person",
    });

    renderWithRouter(() => (
      <TaskTable tasks={[task]} showProject showComments />
    ));

    const row = screen.getByTestId("task-row");

    expect(within(row).getByTestId("task-title")).toHaveTextContent(task.title);
    // The avatar initials sit outside `task-assignee`, so the cell reads as
    // the display name alone.
    expect(within(row).getByTestId("task-assignee")).toHaveTextContent(
      task.assigneeName,
    );
  });

  it("shows an empty state when there are no tasks", () => {
    renderWithRouter(() => <TaskTable tasks={[]} showProject showComments />);

    expect(
      screen.getByText("No tasks match these filters."),
    ).toBeInTheDocument();
  });
});
