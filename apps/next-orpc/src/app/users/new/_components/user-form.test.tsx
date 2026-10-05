import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UserForm } from "./user-form";
import { rejected, renderWithOrpc } from "@tests/helpers/orpc-harness";
import { makeUser } from "@tests/fixtures/builders";

// The form holds a mutation rather than receiving a Server Action, so the
// procedure is exercised through the harness and its `{ ok: false }` reply is
// what the form renders.
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
// What is asserted here is still the form's own contract: which procedure runs,
// with what, and what it renders from the reply. The procedure's behaviour is
// covered against a real database in
// tests/integration/user-router.integration.test.ts.

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("UserForm", () => {
  it("renders labelled name and email fields", () => {
    renderWithOrpc(<UserForm />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("uses an email input for the address", () => {
    renderWithOrpc(<UserForm />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("renders a cancel link and a create button", () => {
    renderWithOrpc(<UserForm />);

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/users",
    );
    expect(
      screen.getByRole("button", { name: "Create user" }),
    ).toBeInTheDocument();
  });

  it("submits through a form, so the fields are one submit away", () => {
    const { container } = renderWithOrpc(<UserForm />);

    // The `name` attributes no longer carry the values to the server — the
    // mutation is called with a typed object — but the form element is still
    // what makes the control keyboard- and label-correct.
    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.getByLabelText("Name")).toHaveAttribute("name", "name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("name", "email");
  });

  it("marks the name as required in the markup", () => {
    // The server re-checks, but a required field is cheaper to fail on.
    renderWithOrpc(<UserForm />);

    expect(screen.getByLabelText("Name")).toBeRequired();
  });

  it("calls users.create with the typed values", async () => {
    const user = userEvent.setup();
    const { calls } = renderWithOrpc(<UserForm />);

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(calls).toContainEqual({
      path: "users.create",
      input: { name: "Ada Lovelace", email: "ada@example.test" },
    });
  });

  describe("a refused procedure", () => {
    // A validation failure is expected user error, so the procedure resolves
    // rather than throwing. These fields are filled with valid values so the
    // browser's own `required` check does not short-circuit the submit — the
    // point is what the form renders from the reply, not that the browser
    // blocks bad input first.
    async function submitValidForm() {
      const user = userEvent.setup();
      renderWithOrpc(<UserForm />, () =>
        rejected({ email: ["Enter a valid email address."] }),
      );

      await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
      await user.type(screen.getByLabelText("Email"), "ada@example.test");
      await user.click(screen.getByRole("button", { name: "Create user" }));
    }

    it("shows the procedure's message in an alert", async () => {
      const user = userEvent.setup();
      renderWithOrpc(<UserForm />, () =>
        rejected(
          { email: ["Enter a valid email address."] },
          "Missing fields. Failed to create user.",
        ),
      );

      await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
      await user.type(screen.getByLabelText("Email"), "ada@example.test");
      await user.click(screen.getByRole("button", { name: "Create user" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Missing fields. Failed to create user.",
      );
    });

    it("shows a field error against the offending input", async () => {
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
      const user = userEvent.setup();
      renderWithOrpc(<UserForm />, () =>
        rejected({ name: ["User name is required."] }),
      );

      await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
      await user.type(screen.getByLabelText("Email"), "ada@example.test");
      await user.click(screen.getByRole("button", { name: "Create user" }));

      expect(
        await screen.findByText("User name is required."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Name")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("leaves the other field unmarked when only one failed", async () => {
      const user = userEvent.setup();
      renderWithOrpc(<UserForm />, () =>
        rejected({ name: ["User name is required."] }),
      );

      await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
      await user.type(screen.getByLabelText("Email"), "ada@example.test");
      await user.click(screen.getByRole("button", { name: "Create user" }));

      await screen.findByText("User name is required.");
      expect(screen.getByLabelText("Email")).not.toHaveAttribute(
        "aria-invalid",
      );
    });

    it("links the error text to its input for screen readers", async () => {
      await submitValidForm();

      await screen.findByText("Enter a valid email address.");
      expect(screen.getByLabelText("Email")).toHaveAttribute(
        "aria-describedby",
        "user-email-error",
      );
    });

    it("keeps what was typed when the submit is refused", async () => {
      const user = userEvent.setup();
      renderWithOrpc(<UserForm />, () =>
        rejected({ name: ["User name is required."] }),
      );

      await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
      await user.type(screen.getByLabelText("Email"), "ada@example.test");
      await user.click(screen.getByRole("button", { name: "Create user" }));

      await screen.findByText("User name is required.");
      // A refused submit must not wipe the user's input.
      expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
    });
  });

  describe("editing", () => {
    const person = makeUser({ id: 42, name: "Ada Lovelace" });

    it("prefills the fields from the stored row", () => {
      renderWithOrpc(<UserForm person={person} />);

      expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
      expect(screen.getByLabelText("Email")).toHaveValue(person.email);
    });

    it("heads the page and the button for an edit", () => {
      renderWithOrpc(<UserForm person={person} />);

      expect(
        screen.getByRole("heading", { name: "Edit user" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeInTheDocument();
    });

    it("cancels back to the member's own page", () => {
      renderWithOrpc(<UserForm person={person} />);

      expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
        "href",
        `/users/${person.id}`,
      );
    });

    it("calls users.update with the edited values", async () => {
      const user = userEvent.setup();
      const { calls } = renderWithOrpc(<UserForm person={person} />);

      await user.clear(screen.getByLabelText("Name"));
      await user.type(screen.getByLabelText("Name"), "Ada King");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(calls).toContainEqual({
        path: "users.update",
        input: {
          id: person.id,
          name: "Ada King",
          email: person.email,
        },
      });
    });

    it("does not call the create procedure when editing", async () => {
      const user = userEvent.setup();
      const { calls } = renderWithOrpc(<UserForm person={person} />);

      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(calls.map((call) => call.path)).not.toContain("users.create");
    });
  });
});
