import { describe, it, expect, vi } from "vitest";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import userEvent from "@testing-library/user-event";
import { TaskDetail } from "./task-detail";
import {
  makeTaskWithProject,
  makeComment,
  makeUser,
} from "@tests/fixtures/builders";

// Both mutations are bound to a task id by the component, which appends that id
// to the form's own fields. So each takes a single `{ data: FormData }` payload
// and the id reads back as the `taskId` field — naming the tuple is what makes
// `mock.calls` indexable rather than an empty tuple.
type MutationArgs = [payload: { data: FormData }];

/** The reply shape `useServerAction` branches on: `redirectTo` means success. */
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

// `useServerFn` is what hands each sub-component its callable; identity keeps
// the mocks above as the callable, so the spies record the call. The real one
// would reach for the server runtime, which jsdom has none of. The
// importOriginal spread keeps every other export intact.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
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

    renderWithRouter(<TaskDetail task={task} comments={[]} people={people} />);

    expect(
      screen.getByRole("heading", { name: task.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Project: ${task.projectName}`),
    ).toBeInTheDocument();
  });

  it("shows the description", () => {
    const task = makeTaskWithProject({ description: "Distinct description" });

    renderWithRouter(<TaskDetail task={task} comments={[]} people={people} />);

    expect(screen.getByText(task.description)).toBeInTheDocument();
  });

  it("renders the details sidebar", () => {
    const task = makeTaskWithProject({
      assigneeName: "Detail Person",
      updatedAt: "Some day",
    });

    renderWithRouter(<TaskDetail task={task} comments={[]} people={people} />);

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

    renderWithRouter(
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

    renderWithRouter(
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
    renderWithRouter(
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

    renderWithRouter(<TaskDetail task={task} comments={[]} people={people} />);

    await user.type(screen.getByLabelText("Add comment"), "A note");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Author" }),
      "2",
    );
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(createCommentFn).toHaveBeenCalledTimes(1);

    // The task id rides in the same FormData as the comment's own fields, as
    // `taskId`.
    const { data } = createCommentFn.mock.calls[0][0];
    expect(data.get("commentBody")).toBe("A note");
    expect(data.get("commentAuthorId")).toBe("2");
    expect(data.get("taskId")).toBe("77");
  });

  it("keeps what was typed when the comment is rejected", async () => {
    // No `redirectTo`: that is what tells `useServerAction` the comment was
    // refused and the reply is validation state rather than a navigation.
    createCommentFn.mockResolvedValueOnce({
      errors: { commentBody: ["Comment is required."] },
    });

    const user = userEvent.setup();
    renderWithRouter(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
    );

    await user.type(screen.getByLabelText("Add comment"), "A note");
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(await screen.findByText("Comment is required.")).toBeInTheDocument();
    // React would reset an uncontrolled form here and lose the input.
    expect(screen.getByLabelText("Add comment")).toHaveValue("A note");
  });

  it("reports why a comment could not be added", async () => {
    createCommentFn.mockResolvedValueOnce({
      message: "That comment author no longer exists.",
    });

    const user = userEvent.setup();
    renderWithRouter(
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

    renderWithRouter(<TaskDetail task={task} comments={[]} people={people} />);

    await user.click(screen.getByRole("button", { name: "Delete task" }));

    expect(deleteTaskFn).toHaveBeenCalledTimes(1);
    const { data } = deleteTaskFn.mock.calls[0][0];
    expect(data.get("taskId")).toBe("77");
  });

  it("links to the edit form for this task", () => {
    const task = makeTaskWithProject({ id: 77 });

    renderWithRouter(<TaskDetail task={task} comments={[]} people={people} />);

    // Not /tasks/new, which would create a second task instead.
    expect(screen.getByRole("link", { name: "Edit task" })).toHaveAttribute(
      "href",
      `/tasks/${task.id}/edit`,
    );
  });

  it("shows an empty state when there are no comments", () => {
    renderWithRouter(
      <TaskDetail task={makeTaskWithProject()} comments={[]} people={people} />,
    );

    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
  });
});
