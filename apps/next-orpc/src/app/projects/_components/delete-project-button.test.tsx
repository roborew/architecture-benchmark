import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { rejected, renderWithOrpc } from "@tests/helpers/orpc-harness";

import { DeleteProjectButton } from "./delete-project-button";

// The control now holds a tRPC mutation rather than calling a Server Action, so
// the procedure is exercised through the harness instead of being mocked. The
// procedure's own behaviour is covered against a real database in
// tests/integration/project-router.integration.test.ts.

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

describe("DeleteProjectButton", () => {
  it("names the project in its accessible label", () => {
    // The accessible name names the project, so a screen-reader user moving
    // through the list hears which row this deletes.
    renderWithOrpc(<DeleteProjectButton projectId={3} projectName="Website redesign" />);

    expect(
      screen.getByRole("button", { name: "Delete Website redesign" }),
    ).toBeInTheDocument();
  });

  it("submits a form, so the control is a single focusable element", () => {
    const { container } = renderWithOrpc(
      <DeleteProjectButton projectId={3} projectName="Website redesign" />,
    );

    expect(container.querySelector("form")).not.toBeNull();
  });

  it("calls projects.delete with the project's id", async () => {
    const user = userEvent.setup();
    const { calls } = renderWithOrpc(
      <DeleteProjectButton projectId={3} projectName="Website redesign" />,
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Website redesign" }),
    );

    expect(calls).toContainEqual({
      path: "projects.delete",
      input: { id: 3 },
    });
  });

  it("reports the message the procedure returned", async () => {
    // `tasks.project_id` is ON DELETE RESTRICT, so a project that still has work
    // cannot be deleted; the reason has to reach the screen rather than being
    // swallowed.
    const user = userEvent.setup();
    renderWithOrpc(
      <DeleteProjectButton projectId={3} projectName="Website redesign" />,
      () =>
        rejected(
          {},
          "This project still has 3 tasks. Delete them before deleting the project.",
        ),
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Website redesign" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This project still has 3 tasks",
    );
  });

  it("stays on the page when the procedure refused", async () => {
    const user = userEvent.setup();
    renderWithOrpc(
      <DeleteProjectButton projectId={3} projectName="Website redesign" />,
      () => rejected({}, "That project no longer exists."),
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Website redesign" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That project no longer exists.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("shows no alert when the procedure reported no problem", async () => {
    const user = userEvent.setup();
    renderWithOrpc(
      <DeleteProjectButton projectId={3} projectName="Website redesign" />,
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Website redesign" }),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaves the page when the delete succeeds", async () => {
    const user = userEvent.setup();
    renderWithOrpc(
      <DeleteProjectButton projectId={3} projectName="Website redesign" />,
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Website redesign" }),
    );

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/projects"));
  });

  it("disables itself while the delete is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    renderWithOrpc(
      <DeleteProjectButton projectId={3} projectName="Website redesign" />,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Delete Website redesign" }),
    );

    // The control carries an aria-label naming its row, and an aria-label
    // overrides the text content as the accessible name — so the row is found by
    // that label and the pending wording is asserted as text.
    const button = await screen.findByRole("button", {
      name: "Delete Website redesign",
    });
    expect(button).toHaveTextContent("Deleting…");
    expect(button).toBeDisabled();

    release({ ok: true, id: 3 });
  });
});
