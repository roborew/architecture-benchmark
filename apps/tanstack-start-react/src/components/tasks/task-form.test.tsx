import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import userEvent from "@testing-library/user-event";

import { TaskForm } from "./task-form";
import { makeProject, makeTask, makeUser } from "@tests/fixtures/builders";

// The task form was inert markup: no `name` attributes, no `<form>`, and
// hard-coded option lists. These tests pin the parts that make it submit real
// data to the server functions, whose behaviour is covered by
// src/lib/task-actions.integration.test.ts.

// A bound id travels as a field of the FormData rather than as a sibling
// property, so the whole payload a server function receives is this one
// `{ data }` object. Naming it is what makes `mock.calls` indexable and gives
// the assertions a typed FormData to read.
type MutationArgs = [payload: { data: FormData }];

/** The reply shape `useServerAction` branches on: `redirectTo` means success. */
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

// `useServerFn` is what hands each component its callable; identity keeps the
// mocks above as the callable, so the spies record the call. The real one would
// reach for the server runtime, which jsdom has none of. The importOriginal
// spread keeps every other `@tanstack/react-start` export intact.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

/**
 * The FormData a mocked server function was called with.
 *
 * Each mutation takes a single `{ data }` payload, so the FormData is always at
 * position 0. Callers state which mock they mean rather than casting at every
 * call site.
 */
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

/**
 * The primary form's testid, per spec/contract.md: the create path and the edit
 * path share one component but are tagged differently. Only one form with either
 * id is mounted at a time, so a regex resolves to it in both suites below.
 */
const PRIMARY_FORM_ID = /^(create|update)-task-form$/;

/**
 * The primary create/edit form.
 *
 * Scoped because the create-with-comment form below it repeats the same field
 * labels ("Title", "Project"): a page-level `getByLabelText("Title")` would match
 * both, which is a real ambiguity on screen too — so the tests assert against
 * one form at a time.
 */
function primaryForm() {
  return within(screen.getByTestId(PRIMARY_FORM_ID));
}

/** The primary form's element, for cases needing a container rather than queries. */
function primaryFormElement() {
  return screen.getByTestId(PRIMARY_FORM_ID);
}

beforeEach(() => {
  createTaskFn.mockClear();
  updateTaskFn.mockClear();
  createTaskWithCommentFn.mockClear();
  // Each mutation succeeds by replying with where to go next; an undefined
  // `redirectTo` is what `useServerAction` reads as a rejection instead.
  createTaskFn.mockResolvedValue({ redirectTo: "/tasks" });
  updateTaskFn.mockResolvedValue({ redirectTo: "/tasks/101" });
  createTaskWithCommentFn.mockResolvedValue({ redirectTo: "/tasks" });
});

describe("TaskForm (create)", () => {
  it("tags its primary form as the create form", () => {
    renderWithRouter(<TaskForm projects={projects} people={people} />);

    expect(screen.getByTestId("create-task-form")).toBeInTheDocument();
    expect(screen.queryByTestId("update-task-form")).not.toBeInTheDocument();
  });

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

    expect(createTaskFn).toHaveBeenCalledTimes(1);

    // The FormData is the payload's `data`, whole.
    const formData = submittedFormData(createTaskFn);
    expect(formData.get("title")).toBe("Ship it");
    expect(formData.get("projectId")).toBe("2");
    expect(formData.get("assigneeId")).toBe("2");
    expect(formData.get("status")).toBe("done");
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

    const formData = submittedFormData(createTaskFn);
    expect(formData.get("assigneeId")).toBe("");
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

    // spec/contract.md requires both forms on the project board, and they are
    // distinct because only this one is atomic with its comment.
    const form = screen.getByTestId("create-with-comment-form");

    expect(form).toBeInTheDocument();
    expect(within(form).getByLabelText("First comment")).toBeInTheDocument();
    // The create-task fields include `status`; the task schema requires it, so
    // the atomic form must carry it or the insert fails validation.
    expect(within(form).getByRole("combobox", { name: "Status" })).toHaveValue(
      "todo",
    );
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

    expect(createTaskWithCommentFn).toHaveBeenCalledTimes(1);

    const formData = submittedFormData(createTaskWithCommentFn);
    expect(formData.get("commentBody")).toBe("Opening note");
    expect(formData.get("commentAuthorId")).toBe("1");
    // The task fields travel in the same submission, or it would not be one
    // transaction. `status` defaults to todo and must be present, or the task
    // schema rejects the whole atomic insert.
    expect(formData.get("title")).toBe("Atomic task");
    expect(formData.get("status")).toBe("todo");
  });

  it("submits the chosen status from the create-with-comment form", async () => {
    const user = userEvent.setup();
    renderWithRouter(<TaskForm projects={projects} people={people} />);

    const form = screen.getByTestId("create-with-comment-form");

    await user.type(within(form).getByLabelText("Title"), "Statusful task");
    await user.type(within(form).getByLabelText("First comment"), "A note");
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Status" }),
      "in progress",
    );
    await user.click(
      within(form).getByRole("button", { name: "Create with comment" }),
    );

    const formData = submittedFormData(createTaskWithCommentFn);
    expect(formData.get("status")).toBe("in progress");
  });

  it("does not submit the plain create action from this form", () => {
    renderWithRouter(<TaskForm projects={projects} people={people} />);

    // Rendered with no user interaction, so neither action has run.
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

    // The edit path is tagged as the update form, not the create form.
    expect(screen.getByTestId("update-task-form")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Edit task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("submits the edited values", async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <TaskForm projects={projects} people={people} task={task} />,
    );

    await user.clear(primaryForm().getByLabelText("Title"));
    await user.type(primaryForm().getByLabelText("Title"), "Renamed task");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // `updateTaskFn` appends the row id to the form's own fields, so the
    // submitted task is identified by `taskId` inside the same FormData.
    const formData = submittedFormData(updateTaskFn);
    expect(formData.get("title")).toBe("Renamed task");
    expect(formData.get("taskId")).toBe(String(task.id));
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
  it("keeps what was typed when the action rejects the submit", async () => {
    // No `redirectTo`: that is what tells `useServerAction` the mutation was
    // refused and the reply is validation state, not a place to navigate to.
    createTaskFn.mockResolvedValueOnce({
      errors: { title: ["Title is required."] },
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
    createTaskFn.mockResolvedValueOnce({
      errors: { assigneeId: ["That assignee no longer exists."] },
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
