import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeleteUserButton } from "./delete-user-button";
import { makeUser } from "@tests/fixtures/builders";

// Mirrors DeleteProjectButton: a form whose bound action does the work, plus an
// alert region for the message the action returns when a foreign key blocks the
// delete. The action's behaviour is covered against a real database in
// src/lib/user-actions.integration.test.ts.

const deleteUser = vi.fn(async () => ({}));

vi.mock("@/lib/actions", () => ({
  deleteUser: (...args: unknown[]) => deleteUser(...(args as [])),
}));

beforeEach(() => {
  deleteUser.mockClear();
  deleteUser.mockResolvedValue({});
});

describe("DeleteUserButton", () => {
  const person = makeUser({ id: 7, name: "Alex Morgan" });

  it("names the member in its accessible label", () => {
    // Two members can share a display name, so the control has to identify its
    // row — otherwise a screen-reader user hears the same label twice.
    render(<DeleteUserButton person={person} />);

    const button = screen.getByRole("button", { name: /Delete Alex Morgan/ });

    expect(button).toBeInTheDocument();
    expect(button).toHaveAccessibleName(/7/);
  });

  it("submits a form, so the delete works without client state", () => {
    const { container } = render(<DeleteUserButton person={person} />);

    expect(container.querySelector("form")).not.toBeNull();
  });

  it("submits the delete when activated", async () => {
    const user = userEvent.setup();
    render(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    expect(deleteUser).toHaveBeenCalled();
  });

  it("reports the message the action returned", async () => {
    // A member who authored comments cannot be deleted; the reason has to reach
    // the screen rather than being swallowed.
    deleteUser.mockResolvedValue({
      message: "This person still has 2 comments and 2 tasks.",
    });

    const user = userEvent.setup();
    render(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This person still has 2 comments and 2 tasks.",
    );
  });

  it("shows no alert when the action reported no problem", async () => {
    const user = userEvent.setup();
    render(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables itself while the delete is in flight", async () => {
    let settle: (value: Record<string, never>) => void = () => {};
    deleteUser.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    // A second click would submit the delete twice.
    expect(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    ).toBeDisabled();

    settle({});
  });
});
