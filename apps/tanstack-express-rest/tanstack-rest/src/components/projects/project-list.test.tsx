import { makeProject } from "@tests/fixtures/builders";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { describe, expect, it, vi } from "vitest";

import { ProjectList } from "./project-list";

// The row's delete control submits an api mutation through `useApiAction`; it
// is stubbed here (rendering never fires it) and asserted on in its own right
// through the form tests.
vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();

	return { ...actual, deleteProject: vi.fn(async () => ({ ok: true })) };
});

describe("ProjectList", () => {
	it("renders a row for each project plus a header", () => {
		const projects = [makeProject({ id: 1 }), makeProject({ id: 2 })];

		renderWithRouter(<ProjectList projects={projects} />);

		expect(screen.getAllByRole("row")).toHaveLength(projects.length + 1);
	});

	it("links the project name to its detail page", () => {
		const project = makeProject({ id: 7, name: "Linked project" });

		renderWithRouter(<ProjectList projects={[project]} />);

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

		renderWithRouter(<ProjectList projects={[project]} />);

		const row = screen.getByRole("row", { name: /Described/ });

		expect(within(row).getByText(project.description)).toBeInTheDocument();
	});

	it("shows the task, open and created columns", () => {
		const project = makeProject({
			taskCount: 7,
			openTaskCount: 3,
			createdAt: "2026-09-27",
		});

		renderWithRouter(<ProjectList projects={[project]} />);

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
		renderWithRouter(<ProjectList projects={[makeProject()]} />);

		["Project", "Tasks", "Open", "Created"].forEach((header) => {
			expect(
				screen.getByRole("columnheader", { name: header }),
			).toBeInTheDocument();
		});
	});

	it("shows an empty state when there are no projects", () => {
		renderWithRouter(<ProjectList projects={[]} />);

		expect(screen.getByText("No projects yet.")).toBeInTheDocument();
	});

	it("links each row to its edit page", () => {
		const project = makeProject({ id: 7, name: "Editable project" });

		renderWithRouter(<ProjectList projects={[project]} />);

		const row = screen.getByRole("row", { name: new RegExp(project.name) });

		expect(
			within(row).getByRole("link", { name: `Edit ${project.name}` }),
		).toHaveAttribute("href", `/projects/${project.id}/edit`);
	});

	it("offers a delete control naming its project", () => {
		const project = makeProject({ id: 7, name: "Deletable project" });

		renderWithRouter(<ProjectList projects={[project]} />);

		const row = screen.getByRole("row", { name: new RegExp(project.name) });

		expect(
			within(row).getByRole("button", { name: `Delete ${project.name}` }),
		).toBeInTheDocument();
	});

	it("submits delete through a form so it works without JavaScript", () => {
		const project = makeProject({ id: 7, name: "Deletable project" });

		const { container } = renderWithRouter(
			<ProjectList projects={[project]} />,
		);

		const forms = container.querySelectorAll("form");
		expect(forms).toHaveLength(1);
	});
});
