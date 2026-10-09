import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { rejected, renderWithOrpc } from "@tests/helpers/orpc-harness";
import { makeProject, makeTask, makeUser } from "@tests/fixtures/builders";

import { TaskForm } from "./task-form";

// The form now holds tRPC mutations rather than calling Server Actions, so the
// procedures are exercised through the harness and asserted on by path and input.
// The procedures' own behaviour is covered against a real database in
// tests/integration/task-router.integration.test.ts.

const push = vi.fn();

// The component under test imports `orpc` from "@/orpc/client". It has to
// be mocked here rather than in the harness, because vi.mock is hoisted above
// this file's imports: a mock registered inside the helper would arrive after
// the real client had already been captured. The factory is inlined for the
// same reason — a hoisted factory cannot reference an imported binding. See
// tests/helpers/orpc-harness.tsx.
vi.mock("@/orpc/client", () => ({
  get orpc() {
    const utils = (globalThis as { __orpcTestUtils?: unknown }).__orpcTestUtils;

    if (!utils) {
      throw new Error("orpc was read before renderWithOrpc ran.");
    }

    return utils;
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

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

describe("TaskForm (create)", () => {
  it("renders labelled fields for title, description and status", () => {
    renderWithOrpc(<TaskForm projects={projects} people={people} />);

    expect(primaryForm().getByLabelText("Title")).toBeInTheDocument();
    expect(primaryForm().getByLabelText("Description")).toBeInTheDocument();
    expect(
      primaryForm().getByRole("combobox", { name: "Status" }),
    ).toBeInTheDocument();
  });

  it("offers every project and every member in the selects", () => {
    renderWithOrpc(<TaskForm projects={projects} people={people} />);

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
    renderWithOrpc(<TaskForm projects={projects} people={people} />);

    expect(
      within(
        primaryForm().getByRole("combobox", { name: "Assigned user" }),
      ).getByRole("option", { name: "Unassigned" }),
    ).toBeInTheDocument();
  });

  it("defaults the status to todo, per spec/contract.md", () => {
    renderWithOrpc(<TaskForm projects={projects} people={people} />);

    expect(primaryForm().getByRole("combobox", { name: "Status" })).toHaveValue(
      "todo",
    );
  });

  it("calls tasks.create with the chosen project, assignee and status", async () => {
    const user = userEvent.setup();
    const { calls } = renderWithOrpc(
      <TaskForm projects={projects} people={people} />,
    );

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

    expect(calls).toContainEqual({
      path: "tasks.create",
      input: {
        title: "Ship it",
        description: "",
        projectId: 2,
        assigneeId: 2,
        status: "done",
      },
    });
  });

  it("sends null rather than undefined when the unassigned option is chosen", async () => {
    // spec/contract.md gives exactly one way to unassign, so the mutation input
    // models it as `number | null` — never an absent field, which would be a
    // second, indistinguishable state.
    const user = userEvent.setup();
    const { calls } = renderWithOrpc(
      <TaskForm projects={projects} people={people} />,
    );

    await user.type(primaryForm().getByLabelText("Title"), "Unassigned work");
    await user.selectOptions(
      primaryForm().getByRole("combobox", { name: "Assigned user" }),
      "",
    );
    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(calls).toContainEqual(
      expect.objectContaining({
        path: "tasks.create",
        input: expect.objectContaining({ assigneeId: null }),
      }),
    );
  });

  it("leaves for the list once the create succeeds", async () => {
    const user = userEvent.setup();
    renderWithOrpc(<TaskForm projects={projects} people={people} />);

    await user.type(primaryForm().getByLabelText("Title"), "Ship it");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/tasks"));
  });

  it("cancels back to the tasks list", () => {
    renderWithOrpc(<TaskForm projects={projects} people={people} />);

    expect(primaryForm().getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });
});

describe("TaskForm (create with comment)", () => {
  it("offers a separate form carrying the comment fields", () => {
    renderWithOrpc(<TaskForm projects={projects} people={people} />);

    // spec/contract.md requires both forms on this screen, and they are distinct
    // because only this one is atomic with its comment.
    expect(screen.getByTestId("create-with-comment-form")).toBeInTheDocument();
    expect(screen.getByLabelText("First comment")).toBeInTheDocument();
  });

  it("offers a status select, so the form can pass the enum the procedure requires", () => {
    // The form was missing this field, so every submit sent `status: null` and was
    // refused — the atomic path could not be exercised from the browser at all.
    renderWithOrpc(<TaskForm projects={projects} people={people} />);

    const form = within(screen.getByTestId("create-with-comment-form"));

    expect(form.getByRole("combobox", { name: "Status" })).toHaveValue("todo");
  });

  it("submits the comment body and author together with the task", async () => {
    const user = userEvent.setup();
    const { calls } = renderWithOrpc(
      <TaskForm projects={projects} people={people} />,
    );

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

    // One call carrying both halves — the procedure wraps them in a transaction,
    // and splitting them into two calls would defeat that.
    expect(calls).toContainEqual({
      path: "tasks.createWithComment",
      input: expect.objectContaining({
        title: "Atomic task",
        commentBody: "Opening note",
        commentAuthorId: 1,
      }),
    });
  });

  it("does not call the plain create from this form", async () => {
    const user = userEvent.setup();
    const { calls } = renderWithOrpc(
      <TaskForm projects={projects} people={people} />,
    );

    const form = screen.getByTestId("create-with-comment-form");
    await user.type(within(form).getByLabelText("Title"), "Atomic task");
    await user.click(
      within(form).getByRole("button", { name: "Create with comment" }),
    );

    expect(calls.map((call) => call.path)).not.toContain("tasks.create");
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
    renderWithOrpc(
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
    renderWithOrpc(
      <TaskForm projects={projects} people={people} task={task} />,
    );

    expect(
      screen.getByRole("heading", { name: "Edit task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("carries the update-task-form testid, not the create one", () => {
    renderWithOrpc(
      <TaskForm projects={projects} people={people} task={task} />,
    );

    expect(screen.getByTestId("update-task-form")).toBeInTheDocument();
    expect(screen.queryByTestId("create-task-form")).not.toBeInTheDocument();
  });

  it("calls tasks.update with the task's id and no projectId", async () => {
    // spec/contract.md lists the update form's fields as title, status, assignee
    // and description only — a task belongs to its project for its lifetime, so
    // the mutation must not accept a move the form never offers.
    const user = userEvent.setup();
    const { calls } = renderWithOrpc(
      <TaskForm projects={projects} people={people} task={task} />,
    );

    await user.clear(primaryForm().getByLabelText("Title"));
    await user.type(primaryForm().getByLabelText("Title"), "Renamed task");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const call = calls.find((c) => c.path === "tasks.update");

    expect(call?.input).toEqual({
      id: 101,
      title: "Renamed task",
      description: "Existing description",
      status: "in progress",
      assigneeId: null,
    });
    expect(call?.input).not.toHaveProperty("projectId");
  });

  it("hides the create forms while editing", () => {
    // An edit has no comment to create atomically — that is a create-only path.
    renderWithOrpc(
      <TaskForm projects={projects} people={people} task={task} />,
    );

    expect(
      screen.queryByTestId("create-with-comment-form"),
    ).not.toBeInTheDocument();
  });
});

describe("TaskForm (server-side validation)", () => {
  it("keeps what was typed when the procedure rejects the submit", async () => {
    const user = userEvent.setup();
    renderWithOrpc(<TaskForm projects={projects} people={people} />, () =>
      rejected({ title: ["Title is required."] }),
    );

    await user.type(primaryForm().getByLabelText("Title"), "Some work");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    expect(primaryForm().getByLabelText("Title")).toHaveValue("Some work");
    expect(push).not.toHaveBeenCalled();
  });

  it("marks the assignee field invalid when the assignee is gone", async () => {
    const user = userEvent.setup();
    renderWithOrpc(<TaskForm projects={projects} people={people} />, () =>
      rejected({ assigneeId: ["That assignee no longer exists."] }),
    );

    await user.type(primaryForm().getByLabelText("Title"), "Some work");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(
      await screen.findByText("That assignee no longer exists."),
    ).toBeInTheDocument();
    expect(
      primaryForm().getByRole("combobox", { name: "Assigned user" }),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("reports a project that no longer exists against the select", async () => {
    const user = userEvent.setup();
    renderWithOrpc(<TaskForm projects={projects} people={people} />, () =>
      rejected({ projectId: ["That project no longer exists."] }),
    );

    await user.type(primaryForm().getByLabelText("Title"), "Some work");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(
      primaryForm().getByRole("combobox", { name: "Project" }),
    ).toHaveAttribute("aria-invalid", "true");
  });
});
