import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TaskTable } from "./task-table";
import { allTasks } from "@/lib/seed-data";

describe("TaskTable", () => {
  it("renders a row per task", () => {
    render(<TaskTable tasks={allTasks} showProject showComments />);

    expect(screen.getAllByRole("row")).toHaveLength(allTasks.length + 1);
  });

  it("links each task to its detail page", () => {
    render(<TaskTable tasks={allTasks} showProject showComments />);

    const row = screen.getByRole("row", { name: /Draft navigation model/ });

    expect(
      within(row).getByRole("link", { name: "Draft navigation model" }),
    ).toHaveAttribute("href", "/tasks/101");
  });

  it("shows the task id under the title", () => {
    render(<TaskTable tasks={allTasks} showProject showComments />);

    const row = screen.getByRole("row", { name: /Draft navigation model/ });

    expect(within(row).getByText("#101")).toBeInTheDocument();
  });

  it("renders the project column when requested", () => {
    render(<TaskTable tasks={allTasks} showProject showComments />);

    const row = screen.getByRole("row", { name: /Review API response shapes/ });

    expect(within(row).getByText("Mobile application")).toBeInTheDocument();
  });

  it("omits the project column when not requested", () => {
    render(<TaskTable tasks={allTasks} showComments />);

    expect(
      screen.queryByRole("columnheader", { name: "Project" }),
    ).not.toBeInTheDocument();
  });

  it("omits the comments column when not requested", () => {
    render(<TaskTable tasks={allTasks} showProject />);

    expect(
      screen.queryByRole("columnheader", { name: "Comments" }),
    ).not.toBeInTheDocument();
  });

  it("shows comment counts when requested", () => {
    render(<TaskTable tasks={allTasks} showProject showComments />);

    const row = screen.getByRole("row", { name: /Draft navigation model/ });

    expect(within(row).getByText("2")).toBeInTheDocument();
  });

  it("shows an empty state when there are no tasks", () => {
    render(<TaskTable tasks={[]} showProject showComments />);

    expect(
      screen.getByText("No tasks match these filters."),
    ).toBeInTheDocument();
  });
});
