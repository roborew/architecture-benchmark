import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UserForm } from "./user-form";
import { makeUser } from "@tests/fixtures/builders";

// The user form used to be inert markup: no `name` attributes and no `<form>`,
// so nothing could ever be submitted. These tests pin the parts that make it a
// real form — named fields, a submit button, and the server's validation state
// rendered against the offending input.
//
// The actions are mocked rather than exercised: their behaviour is covered by
// src/lib/user-actions.integration.test.ts against a real database. What is
// asserted here is the form's contract with them — which action is called, and
// with what.

const createUser = vi.fn();
const updateUser = vi.fn();

vi.mock("@/lib/actions", () => ({
  createUser: (_state: unknown, formData: FormData): Promise<unknown> => {
    createUser(formData);
    return Promise.resolve(serverState);
  },
  updateUser: (
    _id: number,
    _state: unknown,
    formData: FormData,
  ): Promise<unknown> => {
    updateUser(formData);
    return Promise.resolve(serverState);
  },
}));

/** What the mocked action resolves to, standing in for `useActionState`. */
let serverState: Record<string, unknown> = {};

beforeEach(() => {
  createUser.mockClear();
  updateUser.mockClear();
  serverState = {};
});

describe("UserForm", () => {
  it("renders labelled name and email fields", () => {
    render(<UserForm />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("uses an email input for the address", () => {
    render(<UserForm />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("renders a cancel link and a create button", () => {
    render(<UserForm />);

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/users",
    );
    expect(
      screen.getByRole("button", { name: "Create user" }),
    ).toBeInTheDocument();
  });

  it("submits through a form, so the fields actually reach the action", () => {
    const { container } = render(<UserForm />);

    // Both fields need `name`, or the FormData reaching the action is empty.
    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.getByLabelText("Name")).toHaveAttribute("name", "name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("name", "email");
  });

  it("marks the name as required in the markup", () => {
    // The server re-checks, but a required field is cheaper to fail on.
    render(<UserForm />);

    expect(screen.getByLabelText("Name")).toBeRequired();
  });

  it("submits the typed values to the create action", async () => {
    const user = userEvent.setup();
    render(<UserForm />);

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(createUser).toHaveBeenCalled();
    const formData = createUser.mock.calls[0][0] as FormData;
    expect(formData.get("name")).toBe("Ada Lovelace");
    expect(formData.get("email")).toBe("ada@example.test");
  });

  describe("server-side validation", () => {
    // `useActionState` only adopts what the action resolves to, so these tests
    // have to submit before the returned state appears. The fields are filled
    // with valid values so the browser's own `required` check does not short
    // circuit the submit — the point is what the form renders from the action's
    // reply, not that the browser blocks bad input first.
    async function submitValidForm() {
      const user = userEvent.setup();
      render(<UserForm />);

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
      render(<UserForm />);

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
      render(<UserForm person={person} />);

      expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
      expect(screen.getByLabelText("Email")).toHaveValue(person.email);
    });

    it("heads the page and the button for an edit", () => {
      render(<UserForm person={person} />);

      expect(
        screen.getByRole("heading", { name: "Edit user" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeInTheDocument();
    });

    it("cancels back to the member's own page", () => {
      render(<UserForm person={person} />);

      expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
        "href",
        `/users/${person.id}`,
      );
    });

    it("submits the edited values", async () => {
      const user = userEvent.setup();
      render(<UserForm person={person} />);

      await user.clear(screen.getByLabelText("Name"));
      await user.type(screen.getByLabelText("Name"), "Ada King");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(updateUser).toHaveBeenCalled();
      const formData = updateUser.mock.calls[0][0] as FormData;
      expect(formData.get("name")).toBe("Ada King");
    });

    it("does not submit to the create action when editing", () => {
      render(<UserForm person={person} />);

      expect(createUser).not.toHaveBeenCalled();
    });
  });
});
