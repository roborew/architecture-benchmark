import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter, screen } from "@tests/helpers/render";
import userEvent from "@testing-library/user-event";

import { DeleteUserButton } from "./delete-user-button";
import { makeUser } from "@tests/fixtures/builders";

// Mirrors DeleteProjectButton: a form whose bound action does the work, plus an
// alert region for the message the action returns when a foreign key blocks the
// delete. The action's behaviour is covered against a real database in
// src/lib/user-actions.integration.test.ts.

/**
 * The payload a server function is called with.
 *
 * A bound id rides as a field of the FormData rather than as a sibling
 * property, so the whole payload is the one `{ data }` object and reading the
 * fields off it is what these tests assert.
 */
type MutationArgs = [payload: { data: FormData }];

/** What `useServerAction` reads back off a resolved mutation. */
type ActionReply = {
  redirectTo?: string;
  message?: string;
  errors?: Record<string, string[]>;
};

const deleteUserFn = vi.fn(
  async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);

vi.mock("@/server/mutations", () => ({
  ID_FIELD: { project: "projectId", task: "taskId", user: "userId" },
  deleteUserFn: (...args: unknown[]) => deleteUserFn(...(args as MutationArgs)),
}));

// `useServerFn` hands the component the function to call; with the real one the
// component would invoke the server runtime, which does not exist in jsdom.
// Identity keeps the mock itself as the callable, so the spy sees the call.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

beforeEach(() => {
  deleteUserFn.mockClear();
  // A delete that succeeds replies with where to go next; `useServerAction`
  // reads that as a success, and an undefined `redirectTo` as a rejection.
  deleteUserFn.mockResolvedValue({ redirectTo: "/users" });
});

describe("DeleteUserButton", () => {
  const person = makeUser({ id: 7, name: "Alex Morgan" });

  it("names the member in its accessible label", () => {
    // Two members can share a display name, so the control has to identify its
    // row — otherwise a screen-reader user hears the same label twice.
    renderWithRouter(<DeleteUserButton person={person} />);

    const button = screen.getByRole("button", { name: /Delete Alex Morgan/ });

    expect(button).toBeInTheDocument();
    expect(button).toHaveAccessibleName(/7/);
  });

  it("submits a form, so the delete works without client state", () => {
    const { container } = renderWithRouter(
      <DeleteUserButton person={person} />,
    );

    expect(container.querySelector("form")).not.toBeNull();
  });

  it("submits the delete when activated", async () => {
    const user = userEvent.setup();
    renderWithRouter(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    expect(deleteUserFn).toHaveBeenCalledTimes(1);
    // The row is identified by the id the component appends to the form's own
    // fields, not by a separate argument.
    const { data } = deleteUserFn.mock.calls[0][0];
    expect(data.get("userId")).toBe("7");
  });

  it("reports the message the action returned", async () => {
    // A member who authored comments cannot be deleted; the reason has to reach
    // the screen rather than being swallowed.
    // No `redirectTo`: that is how `useServerAction` recognises a refusal and
    // keeps the reply as validation state instead of navigating.
    deleteUserFn.mockResolvedValue({
      message: "This person still has 2 comments and 2 tasks.",
    });

    const user = userEvent.setup();
    renderWithRouter(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This person still has 2 comments and 2 tasks.",
    );
  });

  it("shows no alert when the action reported no problem", async () => {
    const user = userEvent.setup();
    renderWithRouter(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables itself while the delete is in flight", async () => {
    let settle: (value: ActionReply) => void = () => {};
    deleteUserFn.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(<DeleteUserButton person={person} />);

    await user.click(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    );

    // A second click would submit the delete twice.
    expect(
      screen.getByRole("button", { name: /Delete Alex Morgan/ }),
    ).toBeDisabled();

    // Settling with no `redirectTo` keeps the transition off the router, so the
    // in-flight assertion above is all this test depends on.
    settle({});
  });
});
