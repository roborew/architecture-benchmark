import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectForm } from "./project-form";

describe("ProjectForm", () => {
  it("renders labelled name and description fields", () => {
    render(<ProjectForm />);

    expect(screen.getByLabelText("Project name")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("renders a cancel link and a create button", () => {
    render(<ProjectForm />);

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeInTheDocument();
  });

  it("does not submit anywhere, since this version implements no writes", () => {
    const { container } = render(<ProjectForm />);

    expect(container.querySelector("form")).toBeNull();
  });
});
