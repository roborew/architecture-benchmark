import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProject, deleteProject, updateProject } from "./projects";

// The write half of the projects api, exercised against a stubbed oRPC
// client: which procedure each mutation reaches, and the input it carries
// (the form's field bag verbatim, plus the id the caller closed over — under
// REST the id rode in the URL). The reads (the listing, one project, the
// board) are the query options' own procedures now
// (src/queries/projects-query.ts).

const { projectsMock } = vi.hoisted(() => ({
	projectsMock: {
		create: vi.fn(),
		update: vi.fn(),
		remove: vi.fn(),
	},
}));

vi.mock("@/orpc/client", () => ({ client: { projects: projectsMock } }));

beforeEach(() => {
	for (const fn of Object.values(projectsMock)) fn.mockReset();
});

describe("createProject", () => {
	it("sends the form's field bag to projects.create, verbatim", async () => {
		projectsMock.create.mockResolvedValue({
			ok: true,
			redirectTo: "/projects/4",
		});

		const values = { name: "New project", description: "d" };

		await expect(createProject(values)).resolves.toEqual({
			ok: true,
			redirectTo: "/projects/4",
		});

		expect(projectsMock.create).toHaveBeenCalledWith(values);
	});
});

describe("updateProject", () => {
	it("sends the field bag plus the id to projects.update", async () => {
		projectsMock.update.mockResolvedValue({ ok: true });

		const values = { name: "Renamed", description: "d" };

		await updateProject(1, values);

		expect(projectsMock.update).toHaveBeenCalledWith({ id: 1, ...values });
	});
});

describe("deleteProject", () => {
	it("sends the id alone to projects.remove", async () => {
		projectsMock.remove.mockResolvedValue({ ok: true });

		await deleteProject(3);

		expect(projectsMock.remove).toHaveBeenCalledWith({ id: 3 });
	});
});
