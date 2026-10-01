import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskDetail } from "./task-detail";
import {
  makeTaskWithProject,
  makeComment,
  makeUser,
} from "@tests/fixtures/builders";

// Both actions are bound to a task id by the component, so React prepends that
// id to the arguments it passes: (id, previousState, formData). Naming the
// tuple is what makes `mock.calls` indexable rather than an empty tuple.
type CreateArgs = [id: unknown, prevState: unknown, formData: FormData];
type UpdateArgs = [id: unknown, prevState: unknown, formData: FormData];

/* eslint-disable @typescript-eslint/no-unused-vars -- the parameters above are
   what make `mock.calls` indexable; it is intentional that they go unread. */
const createComment = vi.fn(async (...args: CreateArgs) => ({}));
const deleteTask = vi.fn(async (...args: UpdateArgs) => ({}));
/* eslint-enable @typescript-eslint/no-unused-vars */

vi.mock("@/lib/actions", () => ({
  createComment: (id: unknown, prevState: unknown, formData: FormData) =>
    createComment(id, prevState, formData),
  deleteTask: (id: unknown, prevState: unknown, formData: FormData) =>
    deleteTask(id, prevState, formData),
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

    render(<TaskDetail task={task} comments={[]} people={people} />);

    expect(
      screen.getByRole("heading", { name: task.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Project: ${task.projectName}`),
    ).toBeInTheDocument();
  });

  it("shows the description", () => {
    const task = makeTaskWithProject({ description: "Distinct description" });

    render(<TaskDetail task={task} comments={[]} people={people} />);

    expect(screen.getByText(task.description)).toBeInTheDocument();
  });

  it("renders the details sidebar", () => {
    const task = makeTaskWithProject({
      assigneeName: "Detail Person",
      updatedAt: "Some day",
    });

    render(<TaskDetail task={task} comments={[]} people={people} />);

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

    render(
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

    render(
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
    render(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
    );

    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Author" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add comment" })).toBeEnabled();
  });

  it("submits the comment body and author for this task", async () => {
    const user = userEvent.setup();
    const task = makeTaskWithProject({ id: 77 });

    render(<TaskDetail task={task} comments={[]} people={people} />);

    await user.type(screen.getByLabelText("Add comment"), "A note");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Author" }),
      "2",
    );
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(createComment).toHaveBeenCalled();

    // The task id is bound first, so the FormData is the third argument.
    const formData = createComment.mock.calls[0][2] as FormData;
    expect(formData.get("commentBody")).toBe("A note");
    expect(formData.get("commentAuthorId")).toBe("2");
  });

  it("keeps what was typed when the comment is rejected", async () => {
    createComment.mockResolvedValueOnce({
      errors: { commentBody: ["Comment is required."] },
    });

    const user = userEvent.setup();
    render(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
    );

    await user.type(screen.getByLabelText("Add comment"), "A note");
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(await screen.findByText("Comment is required.")).toBeInTheDocument();
    // React would reset an uncontrolled form here and lose the input.
    expect(screen.getByLabelText("Add comment")).toHaveValue("A note");
  });

  it("reports why a comment could not be added", async () => {
    createComment.mockResolvedValueOnce({
      message: "That comment author no longer exists.",
    });

    const user = userEvent.setup();
    render(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
    );

    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That comment author no longer exists.",
    );
  });

  it("offers a delete control that submits the delete", async () => {
    const user = userEvent.setup();
    const task = makeTaskWithProject({ id: 77, title: "Doomed task" });

    render(<TaskDetail task={task} comments={[]} people={people} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));

    expect(deleteTask).toHaveBeenCalled();
  });

  it("links to the edit form for this task", () => {
    const task = makeTaskWithProject({ id: 77 });

    render(<TaskDetail task={task} comments={[]} people={people} />);

    // Not /tasks/new, which would create a second task instead.
    expect(screen.getByRole("link", { name: "Edit task" })).toHaveAttribute(
      "href",
      `/tasks/${task.id}/edit`,
    );
  });

  it("shows an empty state when there are no comments", () => {
    render(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
    );

    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
  });
});
