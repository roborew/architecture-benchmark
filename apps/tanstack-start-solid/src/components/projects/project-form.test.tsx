import { describe, expect, it, vi } from "vitest";
import { renderWithRouter, screen } from "@tests/helpers/render";
import userEvent from "@testing-library/user-event";

import { makeProject } from "@tests/fixtures/builders";

import { ProjectForm } from "./project-form";

vi.mock("@tanstack/solid-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/solid-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

type MutationArgs = [payload: { data: FormData }];

type ActionReply = {
  redirectTo?: string;
  message?: string;
  errors?: Record<string, string[]>;
};

const createProjectFn = vi.fn(
  async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);
const updateProjectFn = vi.fn(
  async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);

vi.mock("@/server/mutations", () => ({
  ID_FIELD: { project: "projectId", task: "taskId", user: "userId" },
  createProjectFn: (...args: unknown[]) =>
    createProjectFn(...(args as MutationArgs)),
  updateProjectFn: (...args: unknown[]) =>
    updateProjectFn(...(args as MutationArgs)),
}));

describe("ProjectForm (create)", () => {
  it("renders labelled name and description fields", () => {
    renderWithRouter(() => <ProjectForm />);

    expect(screen.getByLabelText("Project name")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("renders a cancel link and a create button", () => {
    renderWithRouter(() => <ProjectForm />);

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeInTheDocument();
  });

  it("starts with empty fields", () => {
    renderWithRouter(() => <ProjectForm />);

    expect(screen.getByLabelText("Project name")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("submits through a form carrying the named fields", () => {
    const { container } = renderWithRouter(() => <ProjectForm />);

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    expect(form?.querySelector('[name="name"]')).not.toBeNull();
    expect(form?.querySelector('[name="description"]')).not.toBeNull();
  });

  it("heads the page as a new project", () => {
    renderWithRouter(() => <ProjectForm />);

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

    renderWithRouter(() => <ProjectForm project={project} />);

    expect(screen.getByLabelText("Project name")).toHaveValue(project.name);
    expect(screen.getByLabelText("Description")).toHaveValue(
      project.description,
    );
  });

  it("heads the page as an edit and offers a save button", () => {
    renderWithRouter(() => <ProjectForm project={makeProject()} />);

    expect(
      screen.getByRole("heading", { name: "Edit project", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("names the project in the breadcrumb", () => {
    renderWithRouter(() => (
      <ProjectForm project={makeProject({ name: "Named project" })} />
    ));

    expect(screen.getByText("Projects / Named project")).toBeInTheDocument();
  });
});

describe("ProjectForm (rejected submit)", () => {
  it("keeps what was typed when the action reports a validation error", async () => {
    createProjectFn.mockResolvedValueOnce({
      errors: { name: ["Project name is required."] },
    });

    const user = userEvent.setup();
    renderWithRouter(() => <ProjectForm />);

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
