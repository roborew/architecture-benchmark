import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter, screen } from "@tests/helpers/render";
import userEvent from "@testing-library/user-event";

import { UserForm } from "./user-form";
import { makeUser } from "@tests/fixtures/builders";

type MutationArgs = [payload: { data: FormData }];

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

vi.mock("@tanstack/solid-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/solid-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

let serverState: ActionReply = {};

beforeEach(() => {
  createUserFn.mockClear();
  updateUserFn.mockClear();
  serverState = {};
  createUserFn.mockImplementation(async () => serverState);
  updateUserFn.mockImplementation(async () => serverState);
});

describe("UserForm", () => {
  it("renders labelled name and email fields", () => {
    renderWithRouter(() => <UserForm />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("uses an email input for the address", () => {
    renderWithRouter(() => <UserForm />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("renders a cancel link and a create button", () => {
    renderWithRouter(() => <UserForm />);

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/users",
    );
    expect(
      screen.getByRole("button", { name: "Create user" }),
    ).toBeInTheDocument();
  });

  it("submits through a form, so the fields actually reach the action", () => {
    const { container } = renderWithRouter(() => <UserForm />);

    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.getByLabelText("Name")).toHaveAttribute("name", "name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("name", "email");
  });

  it("marks the name as required in the markup", () => {
    renderWithRouter(() => <UserForm />);

    expect(screen.getByLabelText("Name")).toBeRequired();
  });

  it("submits the typed values to the create action", async () => {
    const user = userEvent.setup();
    renderWithRouter(() => <UserForm />);

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(createUserFn).toHaveBeenCalledTimes(1);
    const { data } = createUserFn.mock.calls[0][0];
    expect(data.get("name")).toBe("Ada Lovelace");
    expect(data.get("email")).toBe("ada@example.test");
  });

  describe("server-side validation", () => {
    async function submitValidForm() {
      const user = userEvent.setup();
      renderWithRouter(() => <UserForm />);

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
      renderWithRouter(() => <UserForm />);

      await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
      await user.type(screen.getByLabelText("Email"), "ada@example.test");
      await user.click(screen.getByRole("button", { name: "Create user" }));

      await screen.findByText("User name is required.");
      expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
    });
  });

  describe("editing", () => {
    const person = makeUser({ id: 42, name: "Ada Lovelace" });

    it("prefills the fields from the stored row", () => {
      renderWithRouter(() => <UserForm person={person} />);

      expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
      expect(screen.getByLabelText("Email")).toHaveValue(person.email);
    });

    it("heads the page and the button for an edit", () => {
      renderWithRouter(() => <UserForm person={person} />);

      expect(
        screen.getByRole("heading", { name: "Edit user" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeInTheDocument();
    });

    it("cancels back to the member's own page", () => {
      renderWithRouter(() => <UserForm person={person} />);

      expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
        "href",
        `/users/${person.id}`,
      );
    });

    it("submits the edited values", async () => {
      const user = userEvent.setup();
      renderWithRouter(() => <UserForm person={person} />);

      await user.clear(screen.getByLabelText("Name"));
      await user.type(screen.getByLabelText("Name"), "Ada King");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(updateUserFn).toHaveBeenCalledTimes(1);
      const { data } = updateUserFn.mock.calls[0][0];
      expect(data.get("name")).toBe("Ada King");
      expect(data.get("userId")).toBe(String(person.id));
    });

    it("does not submit to the create action when editing", () => {
      renderWithRouter(() => <UserForm person={person} />);

      expect(createUserFn).not.toHaveBeenCalled();
    });
  });
});
