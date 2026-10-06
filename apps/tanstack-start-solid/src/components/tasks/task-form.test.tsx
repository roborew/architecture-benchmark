import userEvent from "@testing-library/user-event";
import { makeProject, makeTask, makeUser } from "@tests/fixtures/builders";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskForm } from "./task-form";

type MutationArgs = [payload: { data: FormData }];

type ActionReply = {
	redirectTo?: string;
	message?: string;
	errors?: Record<string, string[]>;
};

const createTaskFn = vi.fn(
	async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);
const createTaskWithCommentFn = vi.fn(
	async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);
const updateTaskFn = vi.fn(
	async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);

vi.mock("@/server/mutations", () => ({
	ID_FIELD: { project: "projectId", task: "taskId", user: "userId" },
	createTaskFn: (...args: unknown[]) => createTaskFn(...(args as MutationArgs)),
	createTaskWithCommentFn: (...args: unknown[]) =>
		createTaskWithCommentFn(...(args as MutationArgs)),
	updateTaskFn: (...args: unknown[]) => updateTaskFn(...(args as MutationArgs)),
}));

vi.mock("@tanstack/solid-start", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/solid-start")>();
	return { ...actual, useServerFn: (fn: unknown) => fn };
});

function submittedFormData(mock: { mock: { calls: unknown[][] } }): FormData {
	const payload = mock.mock.calls[0]?.[0] as { data?: unknown } | undefined;

	if (!(payload?.data instanceof FormData)) {
		throw new Error(
			`Expected argument 0 to be { data: FormData }, got ${typeof payload?.data}`,
		);
	}

	return payload.data;
}

const projects = [
	makeProject({ id: 1, name: "Website redesign" }),
	makeProject({ id: 2, name: "Mobile application" }),
];

const people = [
	makeUser({ id: 1, name: "Robin Andrew" }),
	makeUser({ id: 2, name: "Alex Morgan" }),
];

function primaryForm() {
	return within(screen.getByTestId("create-task-form"));
}

function primaryFormElement() {
	return screen.getByTestId("create-task-form");
}

beforeEach(() => {
	createTaskFn.mockClear();
	updateTaskFn.mockClear();
	createTaskWithCommentFn.mockClear();
	createTaskFn.mockResolvedValue({ redirectTo: "/tasks" });
	updateTaskFn.mockResolvedValue({ redirectTo: "/tasks/101" });
	createTaskWithCommentFn.mockResolvedValue({ redirectTo: "/tasks" });
});

describe("TaskForm (create)", () => {
	it("renders labelled fields for title, description and status", () => {
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

		expect(primaryForm().getByLabelText("Title")).toBeInTheDocument();
		expect(primaryForm().getByLabelText("Description")).toBeInTheDocument();
		expect(
			primaryForm().getByRole("combobox", { name: "Status" }),
		).toBeInTheDocument();
	});

	it("offers every project and every member in the selects", () => {
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

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
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

		expect(
			within(
				primaryForm().getByRole("combobox", { name: "Assigned user" }),
			).getByRole("option", { name: "Unassigned" }),
		).toBeInTheDocument();
	});

	it("submits through a form carrying every named field", () => {
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

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
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

		expect(primaryForm().getByRole("combobox", { name: "Status" })).toHaveValue(
			"todo",
		);
	});

	it("submits the chosen project, assignee and status", async () => {
		const user = userEvent.setup();
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

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

		expect(createTaskFn).toHaveBeenCalledTimes(1);

		const formData = submittedFormData(createTaskFn);
		expect(formData.get("title")).toBe("Ship it");
		expect(formData.get("projectId")).toBe("2");
		expect(formData.get("assigneeId")).toBe("2");
		expect(formData.get("status")).toBe("done");
	});

	it("submits an empty assignee when the unassigned option is chosen", async () => {
		const user = userEvent.setup();
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

		await user.type(primaryForm().getByLabelText("Title"), "Unassigned work");
		await user.selectOptions(
			primaryForm().getByRole("combobox", { name: "Assigned user" }),
			"",
		);
		await user.click(screen.getByRole("button", { name: "Create task" }));

		const formData = submittedFormData(createTaskFn);
		expect(formData.get("assigneeId")).toBe("");
	});

	it("cancels back to the tasks list", () => {
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

		expect(primaryForm().getByRole("link", { name: "Cancel" })).toHaveAttribute(
			"href",
			"/tasks",
		);
	});
});

describe("TaskForm (create with comment)", () => {
	it("offers a separate form carrying the comment fields", () => {
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

		expect(screen.getByTestId("create-with-comment-form")).toBeInTheDocument();
		expect(screen.getByLabelText("First comment")).toBeInTheDocument();
	});

	it("submits the comment body and author together with the task", async () => {
		const user = userEvent.setup();
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

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

		expect(createTaskWithCommentFn).toHaveBeenCalledTimes(1);

		const formData = submittedFormData(createTaskWithCommentFn);
		expect(formData.get("commentBody")).toBe("Opening note");
		expect(formData.get("commentAuthorId")).toBe("1");
		expect(formData.get("title")).toBe("Atomic task");
	});

	it("does not submit the plain create action from this form", () => {
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

		expect(createTaskFn).not.toHaveBeenCalled();
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
		renderWithRouter(() => (
			<TaskForm projects={projects} people={people} task={task} />
		));

		expect(primaryForm().getByLabelText("Title")).toHaveValue(task.title);
		expect(primaryForm().getByLabelText("Description")).toHaveValue(
			task.description,
		);
		expect(primaryForm().getByRole("combobox", { name: "Status" })).toHaveValue(
			"in progress",
		);
		expect(primaryForm().getByText("Mobile application")).toBeInTheDocument();
		expect(
			primaryForm().queryByRole("combobox", { name: "Project" }),
		).not.toBeInTheDocument();
	});

	it("heads the page and the button for an edit", () => {
		renderWithRouter(() => (
			<TaskForm projects={projects} people={people} task={task} />
		));

		expect(
			screen.getByRole("heading", { name: "Edit task" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Save changes" }),
		).toBeInTheDocument();
	});

	it("submits the edited values", async () => {
		const user = userEvent.setup();
		renderWithRouter(() => (
			<TaskForm projects={projects} people={people} task={task} />
		));

		await user.clear(primaryForm().getByLabelText("Title"));
		await user.type(primaryForm().getByLabelText("Title"), "Renamed task");
		await user.click(screen.getByRole("button", { name: "Save changes" }));

		const formData = submittedFormData(updateTaskFn);
		expect(formData.get("title")).toBe("Renamed task");
		expect(formData.get("taskId")).toBe(String(task.id));
	});

	it("hides the create forms while editing", () => {
		renderWithRouter(() => (
			<TaskForm projects={projects} people={people} task={task} />
		));

		expect(
			screen.queryByTestId("create-with-comment-form"),
		).not.toBeInTheDocument();
	});
});

describe("TaskForm (server-side validation)", () => {
	it("keeps what was typed when the action rejects the submit", async () => {
		createTaskFn.mockResolvedValueOnce({
			errors: { title: ["Title is required."] },
		});

		const user = userEvent.setup();
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

		await user.type(primaryForm().getByLabelText("Title"), "Some work");
		await user.click(screen.getByRole("button", { name: "Create task" }));

		expect(await screen.findByText("Title is required.")).toBeInTheDocument();
		expect(primaryForm().getByLabelText("Title")).toHaveValue("Some work");
	});

	it("marks the assignee field invalid when the assignee is gone", async () => {
		createTaskFn.mockResolvedValueOnce({
			errors: { assigneeId: ["That assignee no longer exists."] },
		});

		const user = userEvent.setup();
		renderWithRouter(() => <TaskForm projects={projects} people={people} />);

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
