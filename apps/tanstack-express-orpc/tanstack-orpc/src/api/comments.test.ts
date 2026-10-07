import { beforeEach, describe, expect, it, vi } from "vitest";

import { createComment } from "./comments";

// The write half of the comments api, exercised against a stubbed oRPC
// client: which procedure the mutation reaches, and the input it carries.
//
// The field names are the form's own (`body`/`authorId`), not the
// with-comment form's (`commentBody`/`commentAuthorId`): the API keys its
// validation errors by the names the caller actually sent, so the form that
// renders those errors must submit the same spelling. The comments read (the
// 10 most recent on one task) is the query options' own procedure now
// (src/queries/comments-query.ts).

const { tasksMock } = vi.hoisted(() => ({
	tasksMock: {
		addComment: vi.fn(),
	},
}));

vi.mock("@/orpc/client", () => ({ client: { tasks: tasksMock } }));

beforeEach(() => {
	tasksMock.addComment.mockReset();
});

describe("createComment", () => {
	it("sends the field bag plus the task id to tasks.addComment", async () => {
		tasksMock.addComment.mockResolvedValue({ ok: true });

		const values = { body: "A note.", authorId: "1" };

		await expect(createComment(101, values)).resolves.toEqual({ ok: true });

		expect(tasksMock.addComment).toHaveBeenCalledWith({
			id: 101,
			body: "A note.",
			authorId: "1",
		});
	});
});
