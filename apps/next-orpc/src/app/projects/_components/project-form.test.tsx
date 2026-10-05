import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { rejected, renderWithOrpc } from "@tests/helpers/orpc-harness";
import { makeProject } from "@tests/fixtures/builders";

import { ProjectForm } from "./project-form";

// The form now holds a tRPC mutation rather than calling a Server Action, so the
// procedure is exercised through the harness instead of being mocked. The
// procedure's own behaviour is covered against a real database in
// tests/integration/project-router.integration.test.ts.

const push = vi.fn();

// The component under test imports `orpc` from "@/orpc/client". It has to
// be mocked here rather than in the harness, because vi.mock is hoisted above
// this file's imports: a mock registered inside the helper would arrive after
// the real client had already been captured. The factory is inlined for the
// same reason — a hoisted factory cannot reference an imported binding. See
// tests/helpers/orpc-harness.tsx.
vi.mock("@/orpc/client", () => ({
  get orpc() {
    const utils = (globalThis as { __orpcTestUtils?: unknown }).__orpcTestUtils;

    if (!utils) {
      throw new Error("orpc was read before renderWithOrpc ran.");
    }

    return utils;
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("ProjectForm (create)", () => {
  it("renders labelled name and description fields", () => {
    renderWithOrpc(<ProjectForm />);

    expect(screen.getByLabelText("Project name")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("renders a cancel link and a create button", () => {
    renderWithOrpc(<ProjectForm />);

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeInTheDocument();
  });

  it("starts with empty fields", () => {
    renderWithOrpc(<ProjectForm />);

    expect(screen.getByLabelText("Project name")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("heads the page as a new project", () => {
    renderWithOrpc(<ProjectForm />);

    expect(
      screen.getByRole("heading", { name: "New project", level: 1 }),
    ).toBeInTheDocument();
  });

  it("calls projects.create with the typed fields", async () => {
    const user = userEvent.setup();
    const { calls } = renderWithOrpc(<ProjectForm />);

    await user.type(screen.getByLabelText("Project name"), "Website redesign");
    await user.type(
      screen.getByLabelText("Description"),
      "Refresh the public website.",
    );
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(calls).toContainEqual({
      path: "projects.create",
      input: {
        name: "Website redesign",
        description: "Refresh the public website.",
      },
    });
  });

  it("leaves for the list once the create succeeds", async () => {
    const user = userEvent.setup();
    renderWithOrpc(<ProjectForm />);

    await user.type(screen.getByLabelText("Project name"), "Website redesign");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/projects"));
  });
});

describe("ProjectForm (edit)", () => {
  it("prefills the fields from the project", () => {
    const project = makeProject({
      name: "Website redesign",
      description: "Refresh the public website.",
    });

    renderWithOrpc(<ProjectForm project={project} />);

    expect(screen.getByLabelText("Project name")).toHaveValue(project.name);
    expect(screen.getByLabelText("Description")).toHaveValue(
      project.description,
    );
  });

  it("heads the page as an edit and offers a save button", () => {
    renderWithOrpc(<ProjectForm project={makeProject()} />);

    expect(
      screen.getByRole("heading", { name: "Edit project", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("names the project in the breadcrumb", () => {
    renderWithOrpc(
      <ProjectForm project={makeProject({ name: "Named project" })} />,
    );

    expect(screen.getByText("Projects / Named project")).toBeInTheDocument();
  });

  it("calls projects.update with the project's id", async () => {
    const project = makeProject({ id: 42, name: "Named project" });

    const user = userEvent.setup();
    const { calls } = renderWithOrpc(<ProjectForm project={project} />);

    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Renamed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(calls).toContainEqual({
      path: "projects.update",
      input: { id: 42, name: "Renamed", description: project.description },
    });
  });
});

describe("ProjectForm (rejected submit)", () => {
  it("keeps what was typed when the procedure reports a validation error", async () => {
    // A rejected submit must not blank the fields — precisely when the user needs
    // to see what they entered alongside the error.
    const user = userEvent.setup();
    renderWithOrpc(<ProjectForm />, () =>
      rejected({ name: ["Project name is required."] }),
    );

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

  it("does not navigate away when the procedure refuses", async () => {
    const user = userEvent.setup();
    renderWithOrpc(<ProjectForm />, () =>
      rejected({}, "Database Error: Failed to create project."),
    );

    await user.type(screen.getByLabelText("Project name"), "Website redesign");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database Error: Failed to create project.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("marks the offending field invalid for assistive technology", async () => {
    const user = userEvent.setup();
    renderWithOrpc(<ProjectForm />, () =>
      rejected({ name: ["Project name is required."] }),
    );

    await user.type(screen.getByLabelText("Project name"), "Website redesign");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByLabelText("Project name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
