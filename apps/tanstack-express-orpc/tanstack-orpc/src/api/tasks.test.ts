import { ORPCError } from "@orpc/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	createTask,
	createTaskWithComment,
	deleteTask,
	updateTask,
} from "./tasks";

// The write half of the tasks api, exercised against a stubbed oRPC client:
// which procedure each mutation reaches, the input it carries (the form's
// field bag verbatim, plus the id the caller closed over — under REST the id
// rode in the URL), and the outcome envelope / ApiError the hook renders.
//
// The field bag is passed through untouched: the server owns every
// normalisation rule (an empty assignee means \"unassigned\", a numeric string
// is a row id), so the client cannot disagree with itself about how a value
// is spelled. That behaviour is the API's own contract, covered by its
// integration suite; what is pinned here is the wiring.

const { tasksMock } = vi.hoisted(() => ({
	tasksMock: {
		create: vi.fn(),
		createWithComment: vi.fn(),
		update: vi.fn(),
		remove: vi.fn(),
		addComment: vi.fn(),
	},
}));

vi.mock("@/orpc/client", () => ({ client: { tasks: tasksMock } }));

beforeEach(() => {
	for (const fn of Object.values(tasksMock)) fn.mockReset();
});

describe("createTask", () => {
	it("sends the form's field bag to tasks.create, verbatim", async () => {
		tasksMock.create.mockResolvedValue({ ok: true, redirectTo: "/tasks/101" });

		const values = {
			projectId: "2",
			assigneeId: "",
			title: "Draft the model",
			description: "",
			status: "todo",
		};

		await expect(createTask(values)).resolves.toEqual({
			ok: true,
			redirectTo: "/tasks/101",
		});

		// The empty assignee travels as the form submitted it — the server owns
		// the one normalisation rule ("" means unassigned).
		expect(tasksMock.create).toHaveBeenCalledWith(values);
	});

	it("translates a refused write into the ApiError the form renders", async () => {
		tasksMock.create.mockRejectedValue(
			new ORPCError("BAD_REQUEST", {
				message: "Missing fields. Failed to create task.",
				data: {
					error: "Missing fields. Failed to create task.",
					errors: { title: ["Title is required."] },
				},
			}),
		);

		await expect(createTask({ title: "" })).rejects.toMatchObject({
			status: 400,
			message: "Missing fields. Failed to create task.",
			errors: { title: ["Title is required."] },
		});

		expect(tasksMock.create).toHaveBeenCalledTimes(1);
	});
});

describe("updateTask", () => {
	it("sends the field bag plus the id to tasks.update", async () => {
		tasksMock.update.mockResolvedValue({ ok: true });

		const values = {
			title: "Draft the model",
			description: "",
			status: "in progress",
			assigneeId: "4",
		};

		await updateTask(9, values);

		expect(tasksMock.update).toHaveBeenCalledWith({ id: 9, ...values });
	});
});

describe("deleteTask", () => {
	it("sends the id alone to tasks.remove", async () => {
		tasksMock.remove.mockResolvedValue({ ok: true });

		await deleteTask(9);

		expect(tasksMock.remove).toHaveBeenCalledWith({ id: 9 });
	});
});

describe("createTaskWithComment", () => {
	it("sends the form's field bag to tasks.createWithComment, verbatim", async () => {
		tasksMock.createWithComment.mockResolvedValue({ ok: true });

		const values = {
			projectId: "2",
			assigneeId: "",
			title: "Draft the model",
			description: "",
			status: "todo",
			commentBody: "Kicking this off.",
			commentAuthorId: "4",
		};

		await createTaskWithComment(values);

		expect(tasksMock.createWithComment).toHaveBeenCalledWith(values);
	});
});
