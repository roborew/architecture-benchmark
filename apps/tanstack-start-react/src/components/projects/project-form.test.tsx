import { describe, expect, it, vi } from "vitest";
import { renderWithRouter, screen } from "@tests/helpers/render";
import userEvent from "@testing-library/user-event";

import { makeProject } from "@tests/fixtures/builders";

import { ProjectForm } from "./project-form";

// The form submits to a TanStack server function, which must exist as a callable
// stub before it renders. It is asserted against in the integration tests; here
// it only needs to be substitutable.
//
// `useServerFn` is mocked to identity so the stubs below are the functions the
// component actually calls: the real one would reach for the server runtime,
// which jsdom has none of. That importOriginal spread keeps every other
// `@tanstack/react-start` export intact.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

/**
 * A bound id travels as a field of the FormData, so the whole payload is this
 * one `{ data }` object. Naming it keeps `mock.calls` indexable and gives the
 * assertions a typed FormData to read.
 */
type MutationArgs = [payload: { data: FormData }];

/** The reply shape `useServerAction` branches on: `redirectTo` means success. */
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
    renderWithRouter(<ProjectForm />);

    expect(screen.getByLabelText("Project name")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("renders a cancel link and a create button", () => {
    renderWithRouter(<ProjectForm />);

    // A bare path, matching the Next.js app's `<Link href="/projects">`. The
    // route's validateSearch resolves an absent `q` to undefined rather than "",
    // so TanStack omits it instead of serialising the cancel link as
    // `/projects?q=`.
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeInTheDocument();
  });

  it("starts with empty fields", () => {
    renderWithRouter(<ProjectForm />);

    expect(screen.getByLabelText("Project name")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("submits through a form carrying the named fields", () => {
    const { container } = renderWithRouter(<ProjectForm />);

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    // The action reads these exact names, so a rename here silently drops the
    // field rather than failing loudly.
    expect(form?.querySelector('[name="name"]')).not.toBeNull();
    expect(form?.querySelector('[name="description"]')).not.toBeNull();
  });

  it("heads the page as a new project", () => {
    renderWithRouter(<ProjectForm />);

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

    renderWithRouter(<ProjectForm project={project} />);

    expect(screen.getByLabelText("Project name")).toHaveValue(project.name);
    expect(screen.getByLabelText("Description")).toHaveValue(
      project.description,
    );
  });

  it("heads the page as an edit and offers a save button", () => {
    renderWithRouter(<ProjectForm project={makeProject()} />);

    expect(
      screen.getByRole("heading", { name: "Edit project", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("names the project in the breadcrumb", () => {
    renderWithRouter(
      <ProjectForm project={makeProject({ name: "Named project" })} />,
    );

    expect(screen.getByText("Projects / Named project")).toBeInTheDocument();
  });
});

describe("ProjectForm (rejected submit)", () => {
  it("keeps what was typed when the action reports a validation error", async () => {
    // React resets an uncontrolled form once the action settles, so a rejected
    // submit would blank the fields — precisely when the user needs to see what
    // they entered alongside the error. No `redirectTo` is what tells
    // `useServerAction` this was a refusal rather than a success.
    createProjectFn.mockResolvedValueOnce({
      errors: { name: ["Project name is required."] },
    });

    const user = userEvent.setup();
    renderWithRouter(<ProjectForm />);

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
