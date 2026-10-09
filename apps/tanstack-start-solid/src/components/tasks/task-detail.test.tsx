import userEvent from "@testing-library/user-event";
import {
  makeComment,
  makeTaskWithProject,
  makeUser,
} from "@tests/fixtures/builders";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { describe, expect, it, vi } from "vitest";
import { TaskDetail } from "./task-detail";

type MutationArgs = [payload: { data: FormData }];

type ActionReply = {
  redirectTo?: string;
  message?: string;
  errors?: Record<string, string[]>;
};

const createCommentFn = vi.fn(
  async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);
const deleteTaskFn = vi.fn(
  async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);

vi.mock("@/server/mutations", () => ({
  ID_FIELD: { project: "projectId", task: "taskId", user: "userId" },
  createCommentFn: (...args: unknown[]) =>
    createCommentFn(...(args as MutationArgs)),
  deleteTaskFn: (...args: unknown[]) => deleteTaskFn(...(args as MutationArgs)),
}));

vi.mock("@tanstack/solid-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/solid-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

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

    renderWithRouter(() => (
      <TaskDetail task={task} comments={[]} people={people} />
    ));

    expect(
      screen.getByRole("heading", { name: task.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Project: ${task.projectName}`),
    ).toBeInTheDocument();
  });

  it("shows the description", () => {
    const task = makeTaskWithProject({ description: "Distinct description" });

    renderWithRouter(() => (
      <TaskDetail task={task} comments={[]} people={people} />
    ));

    expect(screen.getByText(task.description)).toBeInTheDocument();
  });

  it("renders the details sidebar", () => {
    const task = makeTaskWithProject({
      assigneeName: "Detail Person",
      updatedAt: "Some day",
    });

    renderWithRouter(() => (
      <TaskDetail task={task} comments={[]} people={people} />
    ));

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

    renderWithRouter(() => (
      <TaskDetail
        task={makeTaskWithProject()}
        comments={comments}
        people={people}
      />
    ));

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

    renderWithRouter(() => (
      <TaskDetail
        task={makeTaskWithProject()}
        comments={[comment]}
        people={people}
      />
    ));

    const article = screen.getByRole("article");

    expect(within(article).getByText(comment.authorName)).toBeInTheDocument();
    expect(within(article).getByText(comment.createdAt)).toBeInTheDocument();
    expect(within(article).getByText(comment.body)).toBeInTheDocument();
  });

  it("renders the add-comment form with its fields", () => {
    renderWithRouter(() => (
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />
    ));

    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Author" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add comment" })).toBeEnabled();
  });

  it("submits the comment body and author for this task", async () => {
    const user = userEvent.setup();
    const task = makeTaskWithProject({ id: 77 });

    renderWithRouter(() => (
      <TaskDetail task={task} comments={[]} people={people} />
    ));

    await user.type(screen.getByLabelText("Add comment"), "A note");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Author" }),
      "2",
    );
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(createCommentFn).toHaveBeenCalledTimes(1);

    const { data } = createCommentFn.mock.calls[0][0];
    expect(data.get("commentBody")).toBe("A note");
    expect(data.get("commentAuthorId")).toBe("2");
    expect(data.get("taskId")).toBe("77");
  });

  it("keeps what was typed when the comment is rejected", async () => {
    createCommentFn.mockResolvedValueOnce({
      errors: { commentBody: ["Comment is required."] },
    });

    const user = userEvent.setup();
    renderWithRouter(() => (
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />
    ));

    await user.type(screen.getByLabelText("Add comment"), "A note");
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(await screen.findByText("Comment is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Add comment")).toHaveValue("A note");
  });

  it("reports why a comment could not be added", async () => {
    createCommentFn.mockResolvedValueOnce({
      message: "That comment author no longer exists.",
    });

    const user = userEvent.setup();
    renderWithRouter(() => (
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />
    ));

    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That comment author no longer exists.",
    );
  });

  it("offers a delete control that submits the delete", async () => {
    const user = userEvent.setup();
    const task = makeTaskWithProject({ id: 77, title: "Doomed task" });

    renderWithRouter(() => (
      <TaskDetail task={task} comments={[]} people={people} />
    ));

    await user.click(screen.getByRole("button", { name: "Delete task" }));

    expect(deleteTaskFn).toHaveBeenCalledTimes(1);
    const { data } = deleteTaskFn.mock.calls[0][0];
    expect(data.get("taskId")).toBe("77");
  });

  it("links to the edit form for this task", () => {
    const task = makeTaskWithProject({ id: 77 });

    renderWithRouter(() => (
      <TaskDetail task={task} comments={[]} people={people} />
    ));

    expect(screen.getByRole("link", { name: "Edit task" })).toHaveAttribute(
      "href",
      `/tasks/${task.id}/edit`,
    );
  });

  it("carries every testid the detail contract requires", () => {
    const task = makeTaskWithProject({
      id: 77,
      projectId: 5,
      projectName: "Alpha",
    });
    const comment = makeComment({
      id: 1,
      body: "A body",
      authorName: "Commenter",
      createdAt: "Today, 09:42",
    });

    renderWithRouter(() => (
      <TaskDetail task={task} comments={[comment]} people={people} />
    ));

    for (const id of [
      "task-detail",
      "task-title",
      "task-status",
      "task-description",
      "task-assignee",
      "project-link",
      "task-updated-at",
      "comment-row",
      "comment-body",
      "comment-author",
      "comment-created-at",
      "delete-task-button",
    ]) {
      expect(screen.getByTestId(id), `missing ${id}`).toBeInTheDocument();
    }

    // The parent link points at the project board, not the projects list.
    expect(screen.getByTestId("project-link")).toHaveAttribute(
      "href",
      `/projects/${task.projectId}`,
    );
  });

  it("shows an empty state when there are no comments", () => {
    renderWithRouter(() => (
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />
    ));

    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
  });
});
