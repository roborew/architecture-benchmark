import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { rejected, renderWithTrpc } from "@tests/helpers/trpc-harness";
import {
  makeTaskWithProject,
  makeComment,
  makeUser,
} from "@tests/fixtures/builders";

import { TaskDetail } from "./task-detail";

// Both the add-comment form and the delete control now hold tRPC mutations rather
// than calling Server Actions, so the procedures are exercised through the harness
// and asserted on by path and input. Their own behaviour is covered against a real
// database in tests/integration/task-router.integration.test.ts and
// tests/integration/comments.integration.test.ts.

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const people = [
  makeUser({ id: 1, name: "Robin Andrew" }),
  makeUser({ id: 2, name: "Alex Morgan" }),
];

describe("TaskDetail", () => {
  it("shows the title and its project", () => {
    const task = makeTaskWithProject({
      title: "Detail task",
      projectName: "Alpha",
    });

    renderWithTrpc(<TaskDetail task={task} comments={[]} people={people} />);

    expect(
      screen.getByRole("heading", { name: task.title }),
    ).toBeInTheDocument();
    // The project name is now a link to the parent board (data-testid
    // `project-link`), so it is no longer a single "Project: …" text node.
    expect(screen.getByTestId("project-link")).toHaveTextContent(
      task.projectName,
    );
  });

  it("shows the description", () => {
    const task = makeTaskWithProject({ description: "Distinct description" });

    renderWithTrpc(<TaskDetail task={task} comments={[]} people={people} />);

    expect(screen.getByText(task.description)).toBeInTheDocument();
  });

  it("renders the details sidebar", () => {
    const task = makeTaskWithProject({
      assigneeName: "Detail Person",
      updatedAt: "Some day",
    });

    renderWithTrpc(<TaskDetail task={task} comments={[]} people={people} />);

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

    renderWithTrpc(
      <TaskDetail
        task={makeTaskWithProject()}
        comments={comments}
        people={people}
      />,
    );

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

    renderWithTrpc(
      <TaskDetail
        task={makeTaskWithProject()}
        comments={[comment]}
        people={people}
      />,
    );

    const article = screen.getByRole("article");

    expect(within(article).getByText(comment.authorName)).toBeInTheDocument();
    expect(within(article).getByText(comment.createdAt)).toBeInTheDocument();
    expect(within(article).getByText(comment.body)).toBeInTheDocument();
  });

  it("renders the add-comment form with its fields", () => {
    renderWithTrpc(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
    );

    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Author" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add comment" })).toBeEnabled();
  });

  it("calls comments.create with the task id, body and author", async () => {
    const user = userEvent.setup();
    const task = makeTaskWithProject({ id: 77 });
    const { calls } = renderWithTrpc(
      <TaskDetail task={task} comments={[]} people={people} />,
    );

    await user.type(screen.getByLabelText("Add comment"), "A note");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Author" }),
      "2",
    );
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(calls).toContainEqual({
      path: "comments.create",
      input: { taskId: 77, commentBody: "A note", commentAuthorId: 2 },
    });
  });

  it("keeps what was typed when the comment is rejected", async () => {
    const user = userEvent.setup();
    renderWithTrpc(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
      () => rejected({ commentBody: ["Comment is required."] }),
    );

    await user.type(screen.getByLabelText("Add comment"), "A note");
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(await screen.findByText("Comment is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Add comment")).toHaveValue("A note");
  });

  it("clears the draft once the comment is written", async () => {
    // The one case where blanking the field is right: the draft is now a comment
    // in the list above.
    const user = userEvent.setup();
    renderWithTrpc(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
    );

    await user.type(screen.getByLabelText("Add comment"), "A note");
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    await vi.waitFor(() =>
      expect(screen.getByLabelText("Add comment")).toHaveValue(""),
    );
  });

  it("reports why a comment could not be added", async () => {
    const user = userEvent.setup();
    renderWithTrpc(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
      () => rejected({}, "That comment author no longer exists."),
    );

    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That comment author no longer exists.",
    );
  });

  it("offers a delete control that calls tasks.delete", async () => {
    const user = userEvent.setup();
    const task = makeTaskWithProject({ id: 77, title: "Doomed task" });
    const { calls } = renderWithTrpc(
      <TaskDetail task={task} comments={[]} people={people} />,
    );

    await user.click(screen.getByRole("button", { name: "Delete task" }));

    expect(calls).toContainEqual({ path: "tasks.delete", input: { id: 77 } });
  });

  it("returns to the board the task belonged to, not to the dead detail URL", async () => {
    const user = userEvent.setup();
    const task = makeTaskWithProject({
      id: 77,
      title: "Doomed task",
      projectId: 4,
    });

    renderWithTrpc(<TaskDetail task={task} comments={[]} people={people} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));

    // The detail page for this id is not-found once the row is gone, so
    // navigating there would land the user on a dead URL.
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/projects/4"));
  });

  it("stays put and reports why when the delete is refused", async () => {
    const user = userEvent.setup();
    renderWithTrpc(
      <TaskDetail
        task={makeTaskWithProject({ id: 77 })}
        comments={[]}
        people={people}
      />,
      (path) =>
        path === "tasks.delete"
          ? rejected({}, "That task no longer exists.")
          : { ok: true, id: 1 },
    );

    await user.click(screen.getByRole("button", { name: "Delete task" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That task no longer exists.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("links to the edit form for this task", () => {
    const task = makeTaskWithProject({ id: 77 });

    renderWithTrpc(<TaskDetail task={task} comments={[]} people={people} />);

    // Not /tasks/new, which would create a second task instead.
    expect(screen.getByRole("link", { name: "Edit task" })).toHaveAttribute(
      "href",
      `/tasks/${task.id}/edit`,
    );
  });

  it("shows an empty state when there are no comments", () => {
    renderWithTrpc(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
    );

    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
  });
});
