import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeProject } from "@tests/fixtures/builders";

import { ProjectForm } from "./project-form";

// The form is a Client Component, so the actions it imports must exist as
// callable stubs before it renders. They are asserted against in the action
// tests; here they only need to be substitutable.
const createProject = vi.fn(async () => ({}));
const updateProject = vi.fn(async () => ({}));

vi.mock("@/lib/actions", () => ({
  createProject: (...args: unknown[]) => createProject(...(args as [])),
  updateProject: (...args: unknown[]) => updateProject(...(args as [])),
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

describe("ProjectForm (rejected submit)", () => {
  it("keeps what was typed when the action reports a validation error", async () => {
    // React resets an uncontrolled form once the action settles, so a rejected
    // submit would blank the fields — precisely when the user needs to see what
    // they entered alongside the error.
    createProject.mockResolvedValueOnce({
      errors: { name: ["Project name is required."] },
    });

    const user = userEvent.setup();
    render(<ProjectForm />);

    await user.type(screen.getByLabelText("Project name"), "Website redesign");
    await user.type(
      screen.getByLabelText("Description"),
      "Refresh the public website.",
    );
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(
      await screen.findByText("Project name is required."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Project name")).toHaveValue(
      "Website redesign",
    );
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Refresh the public website.",
    );
  });
});
