import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TaskForm } from "./task-form";
import { makeProject, makeTask, makeUser } from "@tests/fixtures/builders";

// The task form was inert markup: no `name` attributes, no `<form>`, and
// hard-coded option lists. These tests pin the parts that make it submit real
// data to the server actions, whose behaviour is covered by
// src/lib/task-actions.integration.test.ts.

// Given an explicit parameter list rather than `async () => ({})`: a zero-arg
// mock types `mock.calls` as an empty tuple, so reading the FormData a test
// submitted would be a type error even though reading it is exactly what these
// tests exist to do. `submittedFormData` does the asserting, so the values
// themselves are never read.
type CreateArgs = [prevState: unknown, formData: FormData];
type UpdateArgs = [id: unknown, prevState: unknown, formData: FormData];

/* eslint-disable @typescript-eslint/no-unused-vars -- the parameters above are
   what make `mock.calls` indexable; it is intentional that they go unread. */
const createTask = vi.fn(async (...args: CreateArgs) => ({}));
const createTaskWithComment = vi.fn(async (...args: CreateArgs) => ({}));
const updateTask = vi.fn(async (...args: UpdateArgs) => ({}));
/* eslint-enable @typescript-eslint/no-unused-vars */

// Each wrapper takes the two arguments `useActionState` supplies and forwards
// them. `updateTask` is bound to a row id in the component, so its wrapper
// accepts a third argument; both shapes are passed through untouched.
vi.mock("@/lib/actions", () => ({
  createTask: (prevState: unknown, formData: FormData) =>
    createTask(prevState, formData),
  updateTask: (id: unknown, prevState: unknown, formData: FormData) =>
    updateTask(id, prevState, formData),
  createTaskWithComment: (prevState: unknown, formData: FormData) =>
    createTaskWithComment(prevState, formData),
}));

/**
 * The FormData a mocked action was called with.
 *
 * `useActionState` passes `(previousState, formData)`; a bound action such as
 * `updateTask.bind(null, id)` has its id prepended by the bind, so the index
 * differs per action. Callers state which position they mean rather than
 * hard-coding a cast at every call site.
 */
function submittedFormData(
  mock: { mock: { calls: unknown[][] } },
  index: number,
): FormData {
  const value = mock.mock.calls[0]?.[index];

  if (!(value instanceof FormData)) {
    throw new Error(
      `Expected argument ${index} to be FormData, got ${typeof value}`,
    );
  }

  return value;
}

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
/** The primary form's element, for cases needing a container rather than queries. */
function primaryFormElement() {
  // The same component renders the create and the edit form, and the contract
  // gives them different testids; pick whichever one is mounted.
  return (
    screen.queryByTestId("update-task-form") ??
    screen.getByTestId("create-task-form")
  );
}

function primaryForm() {
  return within(primaryFormElement());
}

beforeEach(() => {
  createTask.mockClear();
  updateTask.mockClear();
  createTaskWithComment.mockClear();
  createTask.mockResolvedValue({});
  updateTask.mockResolvedValue({});
  createTaskWithComment.mockResolvedValue({});
});

describe("TaskForm (create)", () => {
  it("renders labelled fields for title, description and status", () => {
    render(<TaskForm projects={projects} people={people} />);

    expect(primaryForm().getByLabelText("Title")).toBeInTheDocument();
    expect(primaryForm().getByLabelText("Description")).toBeInTheDocument();
    expect(
      primaryForm().getByRole("combobox", { name: "Status" }),
    ).toBeInTheDocument();
  });

  it("offers every project and every member in the selects", () => {
    render(<TaskForm projects={projects} people={people} />);

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
    render(<TaskForm projects={projects} people={people} />);

    expect(
      within(
        primaryForm().getByRole("combobox", { name: "Assigned user" }),
      ).getByRole("option", { name: "Unassigned" }),
    ).toBeInTheDocument();
  });

  it("submits through a form carrying every named field", () => {
    render(<TaskForm projects={projects} people={people} />);

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
    render(<TaskForm projects={projects} people={people} />);

    expect(primaryForm().getByRole("combobox", { name: "Status" })).toHaveValue(
      "todo",
    );
  });

  it("submits the chosen project, assignee and status", async () => {
    const user = userEvent.setup();
    render(<TaskForm projects={projects} people={people} />);

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

    expect(createTask).toHaveBeenCalled();

    // The FormData is the action's second argument; the first is the previous
    // state `useActionState` passes in.
    const formData = submittedFormData(createTask, 1);
    expect(formData.get("title")).toBe("Ship it");
    expect(formData.get("projectId")).toBe("2");
    expect(formData.get("assigneeId")).toBe("2");
    expect(formData.get("status")).toBe("done");
  });

  it("submits an empty assignee when the unassigned option is chosen", async () => {
    const user = userEvent.setup();
    render(<TaskForm projects={projects} people={people} />);

    await user.type(primaryForm().getByLabelText("Title"), "Unassigned work");
    await user.selectOptions(
      primaryForm().getByRole("combobox", { name: "Assigned user" }),
      "",
    );
    await user.click(screen.getByRole("button", { name: "Create task" }));

    const formData = submittedFormData(createTask, 1);
    expect(formData.get("assigneeId")).toBe("");
  });

  it("cancels back to the tasks list", () => {
    render(<TaskForm projects={projects} people={people} />);

    expect(primaryForm().getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });
});

describe("TaskForm (create with comment)", () => {
  it("offers a separate form carrying the comment fields", () => {
    render(<TaskForm projects={projects} people={people} />);

    // spec/contract.md requires both forms on the project board, and they are
    // distinct because only this one is atomic with its comment.
    expect(screen.getByTestId("create-with-comment-form")).toBeInTheDocument();
    expect(screen.getByLabelText("First comment")).toBeInTheDocument();
  });

  it("offers every create-task field, including status", () => {
    // spec/contract.md: this form carries "the create-task fields plus
    // commentBody and commentAuthor". `TaskSchema` requires `status` with no
    // default, so omitting it made every atomic submit fail validation and
    // create nothing.
    render(<TaskForm projects={projects} people={people} />);

    const form = within(screen.getByTestId("create-with-comment-form"));

    expect(form.getByRole("combobox", { name: "Project" })).toBeInTheDocument();
    expect(
      form.getByRole("combobox", { name: "Assigned user" }),
    ).toBeInTheDocument();
    expect(form.getByRole("combobox", { name: "Status" })).toHaveValue("todo");
  });

  it("submits the comment body and author together with the task", async () => {
    const user = userEvent.setup();
    render(<TaskForm projects={projects} people={people} />);

    const form = screen.getByTestId("create-with-comment-form");

    await user.type(within(form).getByLabelText("Title"), "Atomic task");
    await user.type(
      within(form).getByLabelText("First comment"),
      "Opening note",
    );
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Status" }),
      "done",
    );
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Comment author" }),
      "1",
    );
    await user.click(
      within(form).getByRole("button", { name: "Create with comment" }),
    );

    expect(createTaskWithComment).toHaveBeenCalled();

    const formData = submittedFormData(createTaskWithComment, 1);
    expect(formData.get("commentBody")).toBe("Opening note");
    expect(formData.get("commentAuthorId")).toBe("1");
    // The task fields travel in the same submission, or it would not be one
    // transaction.
    expect(formData.get("title")).toBe("Atomic task");
    expect(formData.get("status")).toBe("done");
  });

  it("does not submit the plain create action from this form", () => {
    render(<TaskForm projects={projects} people={people} />);

    // Rendered with no user interaction, so neither action has run.
    expect(createTask).not.toHaveBeenCalled();
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
    render(<TaskForm projects={projects} people={people} task={task} />);

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
    render(<TaskForm projects={projects} people={people} task={task} />);

    expect(
      screen.getByRole("heading", { name: "Edit task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("carries the update-task-form testid, not the create one", () => {
    render(<TaskForm projects={projects} people={people} task={task} />);

    expect(screen.getByTestId("update-task-form")).toBeInTheDocument();
    expect(screen.queryByTestId("create-task-form")).not.toBeInTheDocument();
  });

  it("submits the edited values", async () => {
    const user = userEvent.setup();
    render(<TaskForm projects={projects} people={people} task={task} />);

    await user.clear(primaryForm().getByLabelText("Title"));
    await user.type(primaryForm().getByLabelText("Title"), "Renamed task");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // `updateTask` is bound to the row id, which React prepends to the arguments
    // it passes, so the FormData arrives third: (id, previousState, formData).
    const formData = submittedFormData(updateTask, 2);
    expect(formData.get("title")).toBe("Renamed task");
  });

  it("hides the create forms while editing", () => {
    // An edit has no comment to create atomically — that is a create-only path.
    render(<TaskForm projects={projects} people={people} task={task} />);

    expect(
      screen.queryByTestId("create-with-comment-form"),
    ).not.toBeInTheDocument();
  });
});

describe("TaskForm (server-side validation)", () => {
  it("keeps what was typed when the action rejects the submit", async () => {
    createTask.mockResolvedValueOnce({
      errors: { title: ["Title is required."] },
    });

    const user = userEvent.setup();
    render(<TaskForm projects={projects} people={people} />);

    await user.type(primaryForm().getByLabelText("Title"), "Some work");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    // React would reset an uncontrolled form here and lose the input.
    expect(primaryForm().getByLabelText("Title")).toHaveValue("Some work");
  });

  it("marks the assignee field invalid when the assignee is gone", async () => {
    createTask.mockResolvedValueOnce({
      errors: { assigneeId: ["That assignee no longer exists."] },
    });

    const user = userEvent.setup();
    render(<TaskForm projects={projects} people={people} />);

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
