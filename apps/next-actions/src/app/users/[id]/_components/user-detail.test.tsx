import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { UserDetail } from "./user-detail";
import { makeUser, makeTaskWithProject } from "@tests/fixtures/builders";

describe("UserDetail", () => {
  it("shows the person's name and email", () => {
    const person = makeUser({
      name: "Detail Person",
      email: "detail@example.test",
    });

    render(<UserDetail person={person} tasks={[]} />);

    expect(
      screen.getByRole("heading", { name: person.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(person.email)).toBeInTheDocument();
  });

  it("renders the summary counts", () => {
    // Distinct values so each figure is individually assertable.
    const person = makeUser({ assignedTaskCount: 7, commentCount: 4 });

    render(<UserDetail person={person} tasks={[]} />);

    // "Assigned tasks" appears twice by design, as the stat card label
    // and as the table heading, so the counts are asserted instead.
    expect(screen.getAllByText("Assigned tasks")).toHaveLength(2);
    expect(screen.getByText("Comments authored")).toBeInTheDocument();
    expect(
      screen.getByText(String(person.assignedTaskCount)),
    ).toBeInTheDocument();
    expect(screen.getByText(String(person.commentCount))).toBeInTheDocument();
  });

  it("reuses the shared task table with the project column only", () => {
    const task = makeTaskWithProject({
      title: "Assigned task",
      projectName: "Alpha",
      status: "in progress",
    });

    render(<UserDetail person={makeUser()} tasks={[task]} />);

    // The reference shows Project here but omits Comments.
    expect(
      screen.getByRole("columnheader", { name: "Project" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Comments" }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /Assigned task/ })).getByText(
        "In progress",
      ),
    ).toBeInTheDocument();
  });

  it("links each assigned task to its detail page", () => {
    const task = makeTaskWithProject({ id: 88, title: "Linked task" });

    render(<UserDetail person={makeUser()} tasks={[task]} />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByRole("link", { name: task.title })).toHaveAttribute(
      "href",
      `/tasks/${task.id}`,
    );
  });

  it("shows an empty state when the person has no assigned tasks", () => {
    render(<UserDetail person={makeUser()} tasks={[]} />);

    expect(
      screen.getByText("No tasks are assigned to this person."),
    ).toBeInTheDocument();
  });
});
