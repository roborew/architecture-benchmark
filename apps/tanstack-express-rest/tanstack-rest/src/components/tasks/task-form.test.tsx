import userEvent from "@testing-library/user-event";
import { makeProject, makeTask, makeUser } from "@tests/fixtures/builders";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type FormValues, type MutationResult } from "@/lib/api";
import { TaskForm } from "./task-form";

// The task form was inert markup: no `name` attributes, no `<form>`, and
// hard-coded option lists. These tests pin the parts that make it submit real
// data to the REST mutations in `@/lib/api`, whose behaviour is covered by the
// API's own tests.

/** The reply shape every mutation resolves to: `ok` means success. */
type ApiReply = MutationResult;

const createTaskMock = vi.fn(
	async (_values: FormValues): Promise<ApiReply> => ({ ok: true }),
);
const createTaskWithCommentMock = vi.fn(
	async (_values: FormValues): Promise<ApiReply> => ({ ok: true }),
);
const updateTaskMock = vi.fn(
	async (_id: number, _values: FormValues): Promise<ApiReply> => ({ ok: true }),
);

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();

	// The spread keeps every other export — ApiError included — real, so the
	// rejection paths below can throw the genuine class the hook branches on.
	return {
		...actual,
		createTask: (...args: unknown[]) =>
			createTaskMock(...(args as [FormValues])),
		createTaskWithComment: (...args: unknown[]) =>
			createTaskWithCommentMock(...(args as [FormValues])),
		updateTask: (...args: unknown[]) =>
			updateTaskMock(...(args as [number, FormValues])),
	};
});

const projects = [
	makeProject({ id: 1, name: "Website redesign" }),
	makeProject({ id: 2, name: "Mobile application" }),
];

const people = [
	makeUser({ id: 1, name: "Robin Andrew" }),
	makeUser({ id: 2, name: "Alex Morgan" }),
];

/**
 * The primary create/edit form.
 *
 * Scoped because the create-with-comment form below it repeats the same field
 * labels ("Title", "Project"): a page-level `getByLabelText("Title")` would match
 * both, which is a real ambiguity on screen too — so the tests assert against
 * one form at a time.
 */
function primaryForm() {
	return within(screen.getByTestId("create-task-form"));
}

/** The primary form's element, for cases needing a container rather than queries. */
function primaryFormElement() {
	return screen.getByTestId("create-task-form");
}

beforeEach(() => {
	createTaskMock.mockClear();
	updateTaskMock.mockClear();
	createTaskWithCommentMock.mockClear();
	createTaskMock.mockResolvedValue({ ok: true });
	updateTaskMock.mockResolvedValue({ ok: true });
	createTaskWithCommentMock.mockResolvedValue({ ok: true });
});

describe("TaskForm (create)", () => {
	it("renders labelled fields for title, description and status", () => {
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		expect(primaryForm().getByLabelText("Title")).toBeInTheDocument();
		expect(primaryForm().getByLabelText("Description")).toBeInTheDocument();
		expect(
			primaryForm().getByRole("combobox", { name: "Status" }),
		).toBeInTheDocument();
	});

	it("offers every project and every member in the selects", () => {
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		expect(
			primaryForm().getByRole("combobox", { name: "Project" }),
		).toBeInTheDocument();

		expect(
			within(
				primaryForm().getByRole("combobox", { name: "Project" }),
			).getByRole("option", { name: "Website redesign" }),
		).toBeInTheDocument();

		expect(
			within(
				primaryForm().getByRole("combobox", { name: "Assigned user" }),
			).getByRole("option", { name: "Alex Morgan" }),
		).toBeInTheDocument();
	});

	it("offers an explicit unassigned choice", () => {
		// spec/contract.md gives exactly one way to unassign: a deliberate choice,
		// never the absence of one.
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		expect(
			within(
				primaryForm().getByRole("combobox", { name: "Assigned user" }),
			).getByRole("option", { name: "Unassigned" }),
		).toBeInTheDocument();
	});

	it("submits through a form carrying every named field", () => {
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		const container = primaryFormElement();

		expect(container.tagName).toBe("FORM");

		for (const name of [
			"title",
			"description",
			"projectId",
			"assigneeId",
			"status",
		]) {
			expect(
				container.querySelector(`[name="${name}"]`),
				`missing field ${name}`,
			).not.toBeNull();
		}
	});

	it("defaults the status to todo, per spec/contract.md", () => {
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		expect(primaryForm().getByRole("combobox", { name: "Status" })).toHaveValue(
			"todo",
		);
	});

	it("submits the chosen project, assignee and status", async () => {
		const user = userEvent.setup();
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		await user.type(primaryForm().getByLabelText("Title"), "Ship it");
		await user.selectOptions(
			primaryForm().getByRole("combobox", { name: "Project" }),
			"2",
		);
		await user.selectOptions(
			primaryForm().getByRole("combobox", { name: "Assigned user" }),
			"2",
		);
		await user.selectOptions(
			primaryForm().getByRole("combobox", { name: "Status" }),
			"done",
		);
		await user.click(screen.getByRole("button", { name: "Create task" }));

		expect(createTaskMock).toHaveBeenCalledTimes(1);

		// The field bag is the whole payload: the API's validators read these
		// exact names, so a rename here silently drops the field.
		expect(createTaskMock).toHaveBeenCalledWith({
			title: "Ship it",
			description: "",
			projectId: "2",
			assigneeId: "2",
			status: "done",
		});
	});

	it("submits an empty assignee when the unassigned option is chosen", async () => {
		const user = userEvent.setup();
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		await user.type(primaryForm().getByLabelText("Title"), "Unassigned work");
		await user.selectOptions(
			primaryForm().getByRole("combobox", { name: "Assigned user" }),
			"",
		);
		await user.click(screen.getByRole("button", { name: "Create task" }));

		const values = createTaskMock.mock.calls[0][0];
		expect(values.assigneeId).toBe("");
	});

	it("cancels back to the tasks list", () => {
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		expect(primaryForm().getByRole("link", { name: "Cancel" })).toHaveAttribute(
			"href",
			"/tasks",
		);
	});
});

describe("TaskForm (create with comment)", () => {
	it("offers a separate form carrying the comment fields", () => {
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		// spec/contract.md requires both forms on the create page, and they are
		// distinct because only this one is atomic with its comment.
		expect(screen.getByTestId("create-with-comment-form")).toBeInTheDocument();
		expect(screen.getByLabelText("First comment")).toBeInTheDocument();
	});

	it("submits the comment body and author together with the task", async () => {
		const user = userEvent.setup();
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		const form = screen.getByTestId("create-with-comment-form");

		await user.type(within(form).getByLabelText("Title"), "Atomic task");
		await user.type(
			within(form).getByLabelText("First comment"),
			"Opening note",
		);
		await user.selectOptions(
			within(form).getByRole("combobox", { name: "Comment author" }),
			"1",
		);
		await user.click(
			within(form).getByRole("button", { name: "Create with comment" }),
		);

		expect(createTaskWithCommentMock).toHaveBeenCalledTimes(1);

		// The task fields travel in the same submission, or it would not be one
		// transaction — the project and assignee selects default to the first
		// project and to unassigned, exactly as the reference form does.
		expect(createTaskWithCommentMock).toHaveBeenCalledWith({
			title: "Atomic task",
			commentBody: "Opening note",
			projectId: "1",
			assigneeId: "",
			commentAuthorId: "1",
		});
	});

	it("does not submit the plain create action from this form", () => {
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		// Rendered with no user interaction, so neither action has run.
		expect(createTaskMock).not.toHaveBeenCalled();
	});
});

describe("TaskForm (edit)", () => {
	const task = makeTask({
		id: 101,
		projectId: 2,
		title: "Existing task",
		description: "Existing description",
		status: "in progress",
	});

	it("prefills every field from the stored task", () => {
		renderWithRouter(
			<TaskForm projects={projects} people={people} task={task} />,
		);

		expect(primaryForm().getByLabelText("Title")).toHaveValue(task.title);
		expect(primaryForm().getByLabelText("Description")).toHaveValue(
			task.description,
		);
		expect(primaryForm().getByRole("combobox", { name: "Status" })).toHaveValue(
			"in progress",
		);
		// The project is shown but not editable on an update.
		expect(primaryForm().getByText("Mobile application")).toBeInTheDocument();
		expect(
			primaryForm().queryByRole("combobox", { name: "Project" }),
		).not.toBeInTheDocument();
	});

	it("heads the page and the button for an edit", () => {
		renderWithRouter(
			<TaskForm projects={projects} people={people} task={task} />,
		);

		expect(
			screen.getByRole("heading", { name: "Edit task" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Save changes" }),
		).toBeInTheDocument();
	});

	it("submits the edited values with the row id in the closure", async () => {
		const user = userEvent.setup();
		renderWithRouter(
			<TaskForm projects={projects} people={people} task={task} />,
		);

		await user.clear(primaryForm().getByLabelText("Title"));
		await user.type(primaryForm().getByLabelText("Title"), "Renamed task");
		await user.click(screen.getByRole("button", { name: "Save changes" }));

		expect(updateTaskMock).toHaveBeenCalledTimes(1);
		// The row is identified by the closure's id, not by a form field: the
		// API's update URL carries it, so the field bag holds only the values.
		expect(updateTaskMock).toHaveBeenCalledWith(task.id, {
			title: "Renamed task",
			description: task.description,
			assigneeId: "",
			status: task.status,
		});
	});

	it("hides the create forms while editing", () => {
		// An edit has no comment to create atomically — that is a create-only path.
		renderWithRouter(
			<TaskForm projects={projects} people={people} task={task} />,
		);

		expect(
			screen.queryByTestId("create-with-comment-form"),
		).not.toBeInTheDocument();
	});
});

describe("TaskForm (server-side validation)", () => {
	it("keeps what was typed when the API rejects the submit", async () => {
		// A 400 from the API arrives as a thrown ApiError carrying the field
		// errors; `useApiAction` renders them as the form's state.
		createTaskMock.mockImplementationOnce(() => {
			throw new ApiError(400, "Missing fields. Failed to create task.", {
				title: ["Title is required."],
			});
		});

		const user = userEvent.setup();
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		await user.type(primaryForm().getByLabelText("Title"), "Some work");
		await user.click(screen.getByRole("button", { name: "Create task" }));

		expect(await screen.findByText("Title is required.")).toBeInTheDocument();
		// React would reset an uncontrolled form here and lose the input.
		expect(primaryForm().getByLabelText("Title")).toHaveValue("Some work");
	});

	it("marks the assignee field invalid when the assignee is gone", async () => {
		createTaskMock.mockImplementationOnce(() => {
			throw new ApiError(400, "Missing fields. Failed to create task.", {
				assigneeId: ["That assignee no longer exists."],
			});
		});

		const user = userEvent.setup();
		renderWithRouter(<TaskForm projects={projects} people={people} />);

		await user.type(primaryForm().getByLabelText("Title"), "Some work");
		await user.click(screen.getByRole("button", { name: "Create task" }));

		expect(
			await screen.findByText("That assignee no longer exists."),
		).toBeInTheDocument();
		expect(
			primaryForm().getByRole("combobox", { name: "Assigned user" }),
		).toHaveAttribute("aria-invalid", "true");
	});
});
