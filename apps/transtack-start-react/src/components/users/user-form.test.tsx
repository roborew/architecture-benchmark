import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter, screen } from "@tests/helpers/render";
import userEvent from "@testing-library/user-event";

import { UserForm } from "./user-form";
import { makeUser } from "@tests/fixtures/builders";

// The user form used to be inert markup: no `name` attributes and no `<form>`,
// so nothing could ever be submitted. These tests pin the parts that make it a
// real form — named fields, a submit button, and the server's validation state
// rendered against the offending input.
//
// The server functions are mocked rather than exercised: their behaviour is
// covered by src/lib/user-actions.integration.test.ts against a real database.
// What is asserted here is the form's contract with them — which one is called,
// and with what.

/**
 * A bound id travels as a field of the FormData, so the whole payload is this
 * one `{ data }` object. Naming it is what keeps `mock.calls` indexable and
 * gives the assertions a typed FormData to read.
 */
type MutationArgs = [payload: { data: FormData }];

/** The reply shape `useServerAction` branches on: `redirectTo` means success. */
type ActionReply = {
  redirectTo?: string;
  message?: string;
  errors?: Record<string, string[]>;
};

const createUserFn = vi.fn(
  async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);
const updateUserFn = vi.fn(
  async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);

vi.mock("@/server/mutations", () => ({
  ID_FIELD: { project: "projectId", task: "taskId", user: "userId" },
  createUserFn: (...args: unknown[]) => createUserFn(...(args as MutationArgs)),
  updateUserFn: (...args: unknown[]) => updateUserFn(...(args as MutationArgs)),
}));

// `useServerFn` is what hands the component its callable; identity keeps the
// mocks above as the callable, so the spies record the call. The real one would
// reach for the server runtime, which jsdom has none of.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

/**
 * What the mocked server function resolves to.
 *
 * `useServerAction` reads an undefined `redirectTo` as a validation failure and
 * keeps the result as component state, so a test that sets only `errors` or
 * `message` is exercising the rejection path.
 */
let serverState: ActionReply = {};

beforeEach(() => {
  createUserFn.mockClear();
  updateUserFn.mockClear();
  serverState = {};
  // Default to a successful create, matching the real action's `redirectTo`.
  createUserFn.mockImplementation(async () => serverState);
  updateUserFn.mockImplementation(async () => serverState);
});

describe("UserForm", () => {
  it("renders labelled name and email fields", () => {
    renderWithRouter(<UserForm />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("uses an email input for the address", () => {
    renderWithRouter(<UserForm />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("renders a cancel link and a create button", () => {
    renderWithRouter(<UserForm />);

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/users",
    );
    expect(
      screen.getByRole("button", { name: "Create user" }),
    ).toBeInTheDocument();
  });

  it("submits through a form, so the fields actually reach the action", () => {
    const { container } = renderWithRouter(<UserForm />);

    // Both fields need `name`, or the FormData reaching the action is empty.
    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.getByLabelText("Name")).toHaveAttribute("name", "name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("name", "email");
  });

  it("marks the name as required in the markup", () => {
    // The server re-checks, but a required field is cheaper to fail on.
    renderWithRouter(<UserForm />);

    expect(screen.getByLabelText("Name")).toBeRequired();
  });

  it("submits the typed values to the create action", async () => {
    const user = userEvent.setup();
    renderWithRouter(<UserForm />);

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(createUserFn).toHaveBeenCalledTimes(1);
    const { data } = createUserFn.mock.calls[0][0];
    expect(data.get("name")).toBe("Ada Lovelace");
    expect(data.get("email")).toBe("ada@example.test");
  });

  describe("server-side validation", () => {
    // `useServerAction` only adopts what the server function resolves to, so
    // these tests have to submit before the returned state appears. The fields
    // are filled with valid values so the browser's own `required` check does not
    // short circuit the submit — the point is what the form renders from the
    // server's reply, not that the browser blocks bad input first. Each reply
    // omits `redirectTo`, which is how the hook is told the submit was refused.
    async function submitValidForm() {
      const user = userEvent.setup();
      renderWithRouter(<UserForm />);

      await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
      await user.type(screen.getByLabelText("Email"), "ada@example.test");
      await user.click(screen.getByRole("button", { name: "Create user" }));
    }

    it("shows the action's message in an alert", async () => {
      serverState = {
        errors: { email: ["Enter a valid email address."] },
        message: "Missing fields. Failed to create user.",
      };

      await submitValidForm();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Missing fields. Failed to create user.",
      );
    });

    it("shows a field error against the offending input", async () => {
      serverState = { errors: { email: ["Enter a valid email address."] } };

      await submitValidForm();

      expect(
        await screen.findByText("Enter a valid email address."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("marks the name invalid when the name failed validation", async () => {
      serverState = { errors: { name: ["User name is required."] } };

      await submitValidForm();

      expect(
        await screen.findByText("User name is required."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Name")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("leaves the other field unmarked when only one failed", async () => {
      serverState = { errors: { name: ["User name is required."] } };

      await submitValidForm();

      await screen.findByText("User name is required.");
      expect(screen.getByLabelText("Email")).not.toHaveAttribute(
        "aria-invalid",
      );
    });

    it("links the error text to its input for screen readers", async () => {
      serverState = { errors: { email: ["Enter a valid email address."] } };

      await submitValidForm();

      await screen.findByText("Enter a valid email address.");
      expect(screen.getByLabelText("Email")).toHaveAttribute(
        "aria-describedby",
        "user-email-error",
      );
    });

    it("keeps what was typed when the submit is rejected", async () => {
      serverState = { errors: { name: ["User name is required."] } };

      const user = userEvent.setup();
      renderWithRouter(<UserForm />);

      await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
      await user.type(screen.getByLabelText("Email"), "ada@example.test");
      await user.click(screen.getByRole("button", { name: "Create user" }));

      await screen.findByText("User name is required.");
      // A rejected submit must not wipe the user's input.
      expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
    });
  });

  describe("editing", () => {
    const person = makeUser({ id: 42, name: "Ada Lovelace" });

    it("prefills the fields from the stored row", () => {
      renderWithRouter(<UserForm person={person} />);

      expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
      expect(screen.getByLabelText("Email")).toHaveValue(person.email);
    });

    it("heads the page and the button for an edit", () => {
      renderWithRouter(<UserForm person={person} />);

      expect(
        screen.getByRole("heading", { name: "Edit user" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeInTheDocument();
    });

    it("cancels back to the member's own page", () => {
      renderWithRouter(<UserForm person={person} />);

      expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
        "href",
        `/users/${person.id}`,
      );
    });

    it("submits the edited values", async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserForm person={person} />);

      await user.clear(screen.getByLabelText("Name"));
      await user.type(screen.getByLabelText("Name"), "Ada King");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(updateUserFn).toHaveBeenCalledTimes(1);
      const { data } = updateUserFn.mock.calls[0][0];
      expect(data.get("name")).toBe("Ada King");
      // The row being edited travels with its own fields, as `userId`.
      expect(data.get("userId")).toBe(String(person.id));
    });

    it("does not submit to the create action when editing", () => {
      renderWithRouter(<UserForm person={person} />);

      expect(createUserFn).not.toHaveBeenCalled();
    });
  });
});
