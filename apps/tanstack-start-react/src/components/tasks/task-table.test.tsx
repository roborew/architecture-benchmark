import { describe, it, expect } from "vitest";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { TaskTable } from "./task-table";
import { makeTaskWithProject } from "@tests/fixtures/builders";

describe("TaskTable", () => {
  it("renders a row per task", () => {
    const tasks = [
      makeTaskWithProject({ id: 1 }),
      makeTaskWithProject({ id: 2 }),
      makeTaskWithProject({ id: 3 }),
    ];

    renderWithRouter(<TaskTable tasks={tasks} showProject showComments />);

    expect(screen.getAllByRole("row")).toHaveLength(tasks.length + 1);
  });

  it("links each task to its detail page", () => {
    const task = makeTaskWithProject({ id: 77, title: "Write the thing" });

    renderWithRouter(<TaskTable tasks={[task]} showProject showComments />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByRole("link", { name: task.title })).toHaveAttribute(
      "href",
      `/tasks/${task.id}`,
    );
  });

  it("shows the task id under the title", () => {
    const task = makeTaskWithProject({ id: 55 });

    renderWithRouter(<TaskTable tasks={[task]} showProject showComments />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByText(`#${task.id}`)).toBeInTheDocument();
  });

  it("renders the project column when requested", () => {
    const task = makeTaskWithProject({ projectName: "Alpha" });

    renderWithRouter(<TaskTable tasks={[task]} showProject showComments />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByText(task.projectName)).toBeInTheDocument();
  });

  it("omits the project column when not requested", () => {
    renderWithRouter(<TaskTable tasks={[makeTaskWithProject()]} showComments />);

    expect(
      screen.queryByRole("columnheader", { name: "Project" }),
    ).not.toBeInTheDocument();
  });

  it("omits the comments column when not requested", () => {
    renderWithRouter(<TaskTable tasks={[makeTaskWithProject()]} showProject />);

    expect(
      screen.queryByRole("columnheader", { name: "Comments" }),
    ).not.toBeInTheDocument();
  });

  it("shows comment counts when requested", () => {
    const task = makeTaskWithProject({ commentCount: 4 });

    renderWithRouter(<TaskTable tasks={[task]} showProject showComments />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(
      within(row).getByText(String(task.commentCount)),
    ).toBeInTheDocument();
  });

  it("humanises each status", () => {
    const tasks = [
      makeTaskWithProject({ id: 1, title: "Todo task", status: "todo" }),
      makeTaskWithProject({
        id: 2,
        title: "In flight task",
        status: "in progress",
      }),
      makeTaskWithProject({ id: 3, title: "Finished task", status: "done" }),
    ];

    renderWithRouter(<TaskTable tasks={tasks} showProject showComments />);

    expect(
      within(screen.getByRole("row", { name: /Todo task/ })).getByText("To do"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /In flight task/ })).getByText(
        "In progress",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /Finished task/ })).getByText(
        "Done",
      ),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no tasks", () => {
    renderWithRouter(<TaskTable tasks={[]} showProject showComments />);

    expect(
      screen.getByText("No tasks match these filters."),
    ).toBeInTheDocument();
  });
});
