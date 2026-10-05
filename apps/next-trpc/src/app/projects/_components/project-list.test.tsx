import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { ProjectList } from "./project-list";
import { renderWithTrpc } from "@tests/helpers/trpc-harness";
import { makeProject } from "@tests/fixtures/builders";

// The row's delete control holds a tRPC mutation and navigates on success, so the
// list is rendered through the harness (which supplies the provider) and
// `useRouter` is stubbed. Nothing here exercises the delete itself — see
// delete-project-button.test.tsx for that.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// A render that keeps the harness's `container` shape without the caller having
// to care that the wrapper is the one doing the rendering.
const render = (ui: React.ReactElement) => renderWithTrpc(ui);

describe("ProjectList", () => {
  it("renders a row for each project plus a header", () => {
    const projects = [makeProject({ id: 1 }), makeProject({ id: 2 })];

    render(<ProjectList projects={projects} />);

    expect(screen.getAllByRole("row")).toHaveLength(projects.length + 1);
  });

  it("links the project name to its detail page", () => {
    const project = makeProject({ id: 7, name: "Linked project" });

    render(<ProjectList projects={[project]} />);

    const row = screen.getByRole("row", { name: new RegExp(project.name) });

    expect(
      within(row).getByRole("link", { name: project.name }),
    ).toHaveAttribute("href", `/projects/${project.id}`);
  });

  it("shows the description under the project name", () => {
    const project = makeProject({
      name: "Described",
      description: "Its description",
    });

    render(<ProjectList projects={[project]} />);

    const row = screen.getByRole("row", { name: /Described/ });

    expect(within(row).getByText(project.description)).toBeInTheDocument();
  });

  it("shows the task, open and created columns", () => {
    const project = makeProject({
      taskCount: 7,
      openTaskCount: 3,
      createdAt: "2026-09-27",
    });

    render(<ProjectList projects={[project]} />);

    const row = screen.getByRole("row", { name: new RegExp(project.name) });

    expect(
      within(row).getByRole("cell", { name: String(project.taskCount) }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("cell", { name: String(project.openTaskCount) }),
    ).toBeInTheDocument();
    expect(within(row).getByText("27 Sep 2026")).toBeInTheDocument();
  });

  it("exposes the reference column headers", () => {
    render(<ProjectList projects={[makeProject()]} />);

    ["Project", "Tasks", "Open", "Created"].forEach((header) => {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    });
  });

  it("shows an empty state when there are no projects", () => {
    render(<ProjectList projects={[]} />);

    expect(screen.getByText("No projects yet.")).toBeInTheDocument();
  });

  it("links each row to its edit page", () => {
    const project = makeProject({ id: 7, name: "Editable project" });

    render(<ProjectList projects={[project]} />);

    const row = screen.getByRole("row", { name: new RegExp(project.name) });

    expect(
      within(row).getByRole("link", { name: `Edit ${project.name}` }),
    ).toHaveAttribute("href", `/projects/${project.id}/edit`);
  });

  it("offers a delete control naming its project", () => {
    const project = makeProject({ id: 7, name: "Deletable project" });

    render(<ProjectList projects={[project]} />);

    const row = screen.getByRole("row", { name: new RegExp(project.name) });

    expect(
      within(row).getByRole("button", { name: `Delete ${project.name}` }),
    ).toBeInTheDocument();
  });

  it("submits delete through a form so the control is one focusable element", () => {
    const project = makeProject({ id: 7, name: "Deletable project" });

    const { container } = render(<ProjectList projects={[project]} />);

    const forms = container.querySelectorAll("form");
    expect(forms).toHaveLength(1);
  });
});
