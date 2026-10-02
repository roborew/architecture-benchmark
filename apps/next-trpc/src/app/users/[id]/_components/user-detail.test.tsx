import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";

import { UserDetail } from "./user-detail";
import { renderWithTrpc } from "@tests/helpers/trpc-harness";
import { makeUser, makeTaskWithProject } from "@tests/fixtures/builders";

// DeleteUserButton is a Client Component with its own form. It used to be
// stubbed by mocking `@/lib/actions`; it now holds a tRPC mutation, so it is
// rendered inside the harness instead. Its behaviour is asserted on in
// delete-user-button.test.tsx.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("UserDetail", () => {
  it("shows the person's name and email", () => {
    const person = makeUser({
      name: "Detail Person",
      email: "detail@example.test",
    });

    renderWithTrpc(<UserDetail person={person} tasks={[]} />);

    expect(
      screen.getByRole("heading", { name: person.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(person.email)).toBeInTheDocument();
  });

  it("renders the summary counts", () => {
    // Distinct values so each figure is individually assertable.
    const person = makeUser({ assignedTaskCount: 7, commentCount: 4 });

    renderWithTrpc(<UserDetail person={person} tasks={[]} />);

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

    renderWithTrpc(<UserDetail person={makeUser()} tasks={[task]} />);

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

    renderWithTrpc(<UserDetail person={makeUser()} tasks={[task]} />);

    const row = screen.getByRole("row", { name: new RegExp(task.title) });

    expect(within(row).getByRole("link", { name: task.title })).toHaveAttribute(
      "href",
      `/tasks/${task.id}`,
    );
  });

  it("shows an empty state when the person has no assigned tasks", () => {
    renderWithTrpc(<UserDetail person={makeUser()} tasks={[]} />);

    expect(
      screen.getByText("No tasks are assigned to this person."),
    ).toBeInTheDocument();
  });

  it("offers an edit link to this member's own edit page", () => {
    // Not /users/new: that would create a second member instead of editing
    // the one on screen.
    renderWithTrpc(<UserDetail person={makeUser({ id: 12 })} tasks={[]} />);

    expect(screen.getByRole("link", { name: "Edit user" })).toHaveAttribute(
      "href",
      "/users/12/edit",
    );
  });

  it("offers a delete control naming the member", () => {
    renderWithTrpc(
      <UserDetail
        person={makeUser({ id: 12, name: "Ada Lovelace" })}
        tasks={[]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Delete Ada Lovelace/ }),
    ).toBeInTheDocument();
  });
});
