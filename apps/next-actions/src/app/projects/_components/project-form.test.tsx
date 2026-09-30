import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { makeProject } from "@tests/fixtures/builders";

import { ProjectForm } from "./project-form";

// The form is a Client Component, so the actions it imports must exist as
// callable stubs before it renders. They are asserted against in the action
// tests; here they only need to be substitutable.
vi.mock("@/lib/actions", () => ({
  createProject: vi.fn(async () => ({})),
  updateProject: vi.fn(async () => ({})),
}));

describe("ProjectForm (create)", () => {
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

  it("starts with empty fields", () => {
    render(<ProjectForm />);

    expect(screen.getByLabelText("Project name")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("submits through a form carrying the named fields", () => {
    const { container } = render(<ProjectForm />);

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    // The action reads these exact names, so a rename here silently drops the
    // field rather than failing loudly.
    expect(form?.querySelector('[name="name"]')).not.toBeNull();
    expect(form?.querySelector('[name="description"]')).not.toBeNull();
  });

  it("heads the page as a new project", () => {
    render(<ProjectForm />);

    expect(
      screen.getByRole("heading", { name: "New project", level: 1 }),
    ).toBeInTheDocument();
  });
});

describe("ProjectForm (edit)", () => {
  it("prefills the fields from the project", () => {
    const project = makeProject({
      name: "Website redesign",
      description: "Refresh the public website.",
    });

    render(<ProjectForm project={project} />);

    expect(screen.getByLabelText("Project name")).toHaveValue(project.name);
    expect(screen.getByLabelText("Description")).toHaveValue(
      project.description,
    );
  });

  it("heads the page as an edit and offers a save button", () => {
    render(<ProjectForm project={makeProject()} />);

    expect(
      screen.getByRole("heading", { name: "Edit project", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("names the project in the breadcrumb", () => {
    render(<ProjectForm project={makeProject({ name: "Named project" })} />);

    expect(screen.getByText("Projects / Named project")).toBeInTheDocument();
  });
});
