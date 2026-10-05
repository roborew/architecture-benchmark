import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeleteUserButton } from "./delete-user-button";
import {
  accepted,
  renderWithOrpc,
  rejected,
} from "@tests/helpers/orpc-harness";
import { makeUser } from "@tests/fixtures/builders";

// The control holds a mutation rather than calling a Server Action, so the
// procedure is exercised through the harness instead of being mocked. The
// procedure's own behaviour is still covered against a real database in
// tests/integration/user-router.integration.test.ts.
//
// The vi.mock must live in THIS file, not the harness: it is hoisted above the
// imports, so a mock registered from inside the helper would land after this
// file's `@/orpc/client` import had already captured the real client. The
// factory is inlined for the same reason — referencing an imported helper would
// hit a temporal dead zone. See tests/helpers/orpc-harness.tsx.
vi.mock("@/orpc/client", () => ({
  get orpc() {
    const utils = (globalThis as { __orpcTestUtils?: unknown }).__orpcTestUtils;

    if (!utils) {
      throw new Error("orpc was read before renderWithOrpc ran.");
    }

    return utils;
  },
}));

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("DeleteUserButton", () => {
  const person = makeUser({ id: 7, name: "Alex Morgan" });

  it("names the member in its accessible label", () => {
    // Two members can share a display name, so the control has to identify its
    // row — otherwise a screen-reader user hears the same label twice.
    renderWithOrpc(<DeleteUserButton person={person} />);

    const button = screen.getByRole("button", { name: /Delete Alex Morgan/ });

    expect(button).toBeInTheDocument();
    expect(button).toHaveAccessibleName(/7/);
  });

  it("submits a form, so the control is a single focusable element", () => {
    const { container } = renderWithOrpc(<DeleteUserButton person={person} />);

    expect(container.querySelector("form")).not.toBeNull();
  });

  it("calls users.delete with the member's id", async () => {
    const user = userEvent.setup();
    const { calls } = renderWithOrpc(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    expect(calls).toContainEqual({
      path: "users.delete",
      input: { id: person.id },
    });
  });

  it("reports the message the procedure returned", async () => {
    // A member who authored comments cannot be deleted; the reason has to reach
    // the screen rather than being swallowed.
    const user = userEvent.setup();
    renderWithOrpc(<DeleteUserButton person={person} />, () =>
      rejected(
        {},
        "This person still has 2 comments and 2 tasks. Remove the comments before deleting.",
      ),
    );

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This person still has 2 comments",
    );
  });

  it("shows no alert when the procedure reported no problem", async () => {
    const user = userEvent.setup();
    renderWithOrpc(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaves the page when the delete succeeds", async () => {
    const user = userEvent.setup();
    renderWithOrpc(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/users"));
  });

  it("disables itself while the delete is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    renderWithOrpc(
      <DeleteUserButton person={person} />,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    // The control carries an aria-label naming its row, and an aria-label
    // overrides the text content as the accessible name — so the row is found by
    // that label and the pending wording is asserted as text.
    const button = await screen.findByRole("button", {
      name: /Delete Alex Morgan/,
    });
    expect(button).toHaveTextContent("Deleting…");
    expect(button).toBeDisabled();

    release(accepted());
  });
});
