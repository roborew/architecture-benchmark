import userEvent from "@testing-library/user-event";
import { makeProject } from "@tests/fixtures/builders";
import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it, vi } from "vitest";

import { ApiError, type FormValues, type MutationResult } from "@/api/api";
import { ProjectForm } from "./project-form";

// The form submits through `useApiAction`, which sends the form's field bag to
// the REST mutations in `@/api/projects`. Those are mocked rather than exercised:
// their behaviour is covered by the API's own tests. What is asserted here is
// the form's contract with them — which one is called, and with what.

/** The reply shape every mutation resolves to: `ok` means success. */
type ApiReply = MutationResult;

const createProjectMock = vi.fn(
	async (_values: FormValues): Promise<ApiReply> => ({ ok: true }),
);
const updateProjectMock = vi.fn(
	async (_id: number, _values: FormValues): Promise<ApiReply> => ({ ok: true }),
);

vi.mock("@/api/projects", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/api/projects")>();

	// The spread keeps every other export — ApiError included — real, so the
	// rejection paths below can throw the genuine class the hook branches on.
	return {
		...actual,
		createProject: (...args: unknown[]) =>
			createProjectMock(...(args as [FormValues])),
		updateProject: (...args: unknown[]) =>
			updateProjectMock(...(args as [number, FormValues])),
	};
});

describe("ProjectForm (create)", () => {
	it("renders labelled name and description fields", () => {
		renderWithRouter(<ProjectForm />);

		expect(screen.getByLabelText("Project name")).toBeInTheDocument();
		expect(screen.getByLabelText("Description")).toBeInTheDocument();
	});

	it("renders a cancel link and a create button", () => {
		renderWithRouter(<ProjectForm />);

		// A bare path, matching the reference app's `<Link href="/projects">`.
		// The route's validateSearch resolves an absent `q` to undefined rather
		// than "", so TanStack omits it instead of serialising the cancel link
		// as "/projects?q=".
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

	it("submits the typed values to the create action", async () => {
		const user = userEvent.setup();
		renderWithRouter(<ProjectForm />);

		await user.type(screen.getByLabelText("Project name"), "Website redesign");
		await user.type(
			screen.getByLabelText("Description"),
			"Refresh the public website.",
		);
		await user.click(screen.getByRole("button", { name: "Create project" }));

		expect(createProjectMock).toHaveBeenCalledTimes(1);
		expect(createProjectMock).toHaveBeenCalledWith({
			name: "Website redesign",
			description: "Refresh the public website.",
		});
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

	it("submits the edited values with the row id in the closure", async () => {
		const project = makeProject({ id: 7, name: "Editable project" });
		const user = userEvent.setup();

		renderWithRouter(<ProjectForm project={project} />);

		await user.clear(screen.getByLabelText("Project name"));
		await user.type(screen.getByLabelText("Project name"), "Renamed project");
		await user.click(screen.getByRole("button", { name: "Save changes" }));

		expect(updateProjectMock).toHaveBeenCalledTimes(1);
		// The row is identified by the closure's id, not by a form field: the
		// API's update URL carries it, so the field bag holds only the values.
		expect(updateProjectMock).toHaveBeenCalledWith(project.id, {
			name: "Renamed project",
			description: project.description,
		});
		expect(createProjectMock).not.toHaveBeenCalled();
	});
});

describe("ProjectForm (rejected submit)", () => {
	it("keeps what was typed when the action reports a validation error", async () => {
		// A 400 from the API arrives as a thrown ApiError carrying the field
		// errors; `useApiAction` renders them as the form's state — precisely
		// when the user needs to see what they entered alongside the error.
		createProjectMock.mockImplementationOnce(() => {
			throw new ApiError(400, "Missing fields. Failed to create project.", {
				name: ["Project name is required."],
			});
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

	it("links the error text to its input for screen readers", async () => {
		createProjectMock.mockImplementationOnce(() => {
			throw new ApiError(400, "Missing fields. Failed to create project.", {
				name: ["Project name is required."],
			});
		});

		const user = userEvent.setup();
		renderWithRouter(<ProjectForm />);

		await user.type(screen.getByLabelText("Project name"), "Website redesign");
		await user.click(screen.getByRole("button", { name: "Create project" }));

		await screen.findByText("Project name is required.");
		expect(screen.getByLabelText("Project name")).toHaveAttribute(
			"aria-describedby",
			"project-name-error",
		);
	});
});
