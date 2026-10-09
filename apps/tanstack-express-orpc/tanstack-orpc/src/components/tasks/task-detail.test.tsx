import userEvent from "@testing-library/user-event";
import {
	makeComment,
	makeTaskWithProject,
	makeUser,
} from "@tests/fixtures/builders";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type FormValues, type MutationResult } from "@/api/api";
import { TaskDetail } from "./task-detail";

// The add-comment form and the delete control both submit api mutations with
// the task id bound in the closure, so the field bag carries only the form's
// own fields. The comment form's fields are named `body` and `authorId` — the
// endpoint's own spelling, not the reference form's `commentBody` /
// `commentAuthorId` — because the API keys its validation errors by the names
// the request actually sent (src/api/comments.ts, `createComment`).

/** The reply shape every mutation resolves to: `ok` means success. */
type ApiReply = MutationResult;

const createCommentMock = vi.fn(
	async (_values: FormValues): Promise<ApiReply> => ({ ok: true }),
);
const deleteTaskMock = vi.fn(
	async (_id: number): Promise<ApiReply> => ({
		ok: true,
	}),
);

vi.mock("@/api/comments", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/api/comments")>();

	// The spread keeps every other export — ApiError included — real, so the
	// rejection paths below can throw the genuine class the hook branches on.
	return {
		...actual,
		createComment: (...args: unknown[]) =>
			createCommentMock(...(args as [FormValues])),
	};
});

vi.mock("@/api/tasks", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/api/tasks")>();

	return {
		...actual,
		deleteTask: (...args: unknown[]) => deleteTaskMock(...(args as [number])),
	};
});

beforeEach(() => {
	createCommentMock.mockClear();
	deleteTaskMock.mockClear();
	createCommentMock.mockResolvedValue({ ok: true });
	deleteTaskMock.mockResolvedValue({ ok: true });
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

		expect(createCommentMock).toHaveBeenCalledTimes(1);

		// The task id rides the closure into the mutation's URL, so the field
		// bag carries only the comment's own fields — under the endpoint's own
		// names, `body` and `authorId`.
		expect(createCommentMock).toHaveBeenCalledWith(77, {
			body: "A note",
			authorId: "2",
		});
	});

	it("keeps what was typed when the comment is rejected", async () => {
		// A 400 from the API arrives as a thrown ApiError carrying the field
		// errors keyed by the names the request sent — `body`, here.
		createCommentMock.mockImplementationOnce(() => {
			throw new ApiError(400, "Missing fields. Failed to add comment.", {
				body: ["Comment is required."],
			});
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
		createCommentMock.mockImplementationOnce(() => {
			throw new ApiError(409, "That comment author no longer exists.", {});
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

		expect(deleteTaskMock).toHaveBeenCalledTimes(1);
		// The row is identified by the closure's id, not by a form field: the
		// API's delete URL carries it.
		expect(deleteTaskMock).toHaveBeenCalledWith(77);
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
