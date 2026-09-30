import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserForm } from "./user-form";

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
    expect(screen.getByRole("button", { name: "Create user" })).toBeInTheDocument();
  });

  it("does not submit anywhere, since this version implements no writes", () => {
    const { container } = render(<UserForm />);

    expect(container.querySelector("form")).toBeNull();
  });
});
