import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TaskDetail } from "./task-detail";
import { makeTaskWithProject, makeComment } from "@tests/fixtures/builders";

describe("TaskDetail", () => {
  it("shows the title and its project", () => {
    const task = makeTaskWithProject({ title: "Detail task", projectName: "Alpha" });

    render(<TaskDetail task={task} comments={[]} />);

    expect(
      screen.getByRole("heading", { name: task.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(`Project: ${task.projectName}`)).toBeInTheDocument();
  });

  it("shows the description", () => {
    const task = makeTaskWithProject({ description: "Distinct description" });

    render(<TaskDetail task={task} comments={[]} />);

    expect(screen.getByText(task.description)).toBeInTheDocument();
  });

  it("renders the details sidebar", () => {
    const task = makeTaskWithProject({
      assigneeName: "Detail Person",
      updatedAt: "Some day",
    });

    render(<TaskDetail task={task} comments={[]} />);

    const details = screen.getByRole("region", { name: "Task details" });

    expect(within(details).getByText("Status")).toBeInTheDocument();
    expect(within(details).getByText("Project")).toBeInTheDocument();
    expect(within(details).getByText("Assigned to")).toBeInTheDocument();
    expect(within(details).getByText(task.assigneeName)).toBeInTheDocument();
    expect(within(details).getByText(task.updatedAt)).toBeInTheDocument();
  });

  it("shows the rendered comment count in the heading", () => {
    const comments = [
      makeComment({ id: 1, body: "First comment" }),
      makeComment({ id: 2, body: "Second comment" }),
    ];

    render(<TaskDetail task={makeTaskWithProject()} comments={comments} />);

    expect(
      screen.getByRole("heading", { name: /Comments \(2\)/ }),
    ).toBeInTheDocument();
  });

  it("renders a comment article with author and timestamp", () => {
    const comment = makeComment({
      authorName: "Commenter",
      body: "A body",
      createdAt: "Today, 09:42",
    });

    render(<TaskDetail task={makeTaskWithProject()} comments={[comment]} />);

    const article = screen.getByRole("article");

    expect(within(article).getByText(comment.authorName)).toBeInTheDocument();
    expect(within(article).getByText(comment.createdAt)).toBeInTheDocument();
    expect(within(article).getByText(comment.body)).toBeInTheDocument();
  });

  it("renders the add-comment form as static chrome", () => {
    render(<TaskDetail task={makeTaskWithProject()} comments={[]} />);

    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Author" })).toBeInTheDocument();
    // Presentational only: this version renders static data and does
    // not implement writes.
    expect(screen.getByRole("button", { name: "Add comment" })).toBeEnabled();
  });

  it("shows an empty state when there are no comments", () => {
    render(<TaskDetail task={makeTaskWithProject()} comments={[]} />);

    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
  });
});
