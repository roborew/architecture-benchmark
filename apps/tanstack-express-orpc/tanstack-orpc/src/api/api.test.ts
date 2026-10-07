import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { ApiError, call } from "./api";

// The shared half of the api layer: the one place an ORPCError from the
// client is turned into the ApiError the forms render. The per-feature
// modules' tests (procedure wiring, field-bag passthrough) live beside their
// modules; these are the pieces every write shares.
//
// The mapping is deliberate: the REST variant's envelope is the contract the
// `useApiAction` hook and every form test were written against (a status, a
// message, a field → messages map), so the transport's error channel is
// translated into that shape here rather than pushing ORPCError through the
// whole app — one import boundary, one place to change if the wire ever does.

function refusal(
	code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT",
	message: string,
	data?: unknown,
): ORPCError<string, unknown> {
	return new ORPCError(code, { message, data });
}

describe("call", () => {
	it("resolves with the procedure's reply untouched", async () => {
		const reply = { ok: true as const, message: "Task created." };

		await expect(call(() => Promise.resolve(reply))).resolves.toBe(reply);
	});

	it("translates a BAD_REQUEST into the 400 ApiError the forms render", async () => {
		const error = refusal(
			"BAD_REQUEST",
			"Missing fields. Failed to create task.",
			{
				error: "Missing fields. Failed to create task.",
				errors: { title: ["Title is required."] },
			},
		);

		try {
			await call(() => Promise.reject(error));
			expect.unreachable("the call must reject");
		} catch (caught) {
			expect(caught).toBeInstanceOf(ApiError);
			if (caught instanceof ApiError) {
				expect(caught.status).toBe(400);
				expect(caught.message).toBe("Missing fields. Failed to create task.");
				expect(caught.errors).toEqual({ title: ["Title is required."] });
			}
		}
	});

	it("keeps an empty errors map when the refusal carries none", async () => {
		const error = refusal("NOT_FOUND", "That task no longer exists.", {
			error: "That task no longer exists.",
		});

		try {
			await call(() => Promise.reject(error));
			expect.unreachable("the call must reject");
		} catch (caught) {
			expect(caught).toBeInstanceOf(ApiError);
			if (caught instanceof ApiError) {
				expect(caught.status).toBe(404);
				expect(caught.errors).toEqual({});
			}
		}
	});

	it("translates the FK guard's CONFLICT into 409", async () => {
		const error = refusal(
			"CONFLICT",
			"This project still has 1 task. Delete it before deleting the project.",
			{
				error:
					"This project still has 1 task. Delete it before deleting the project.",
			},
		);

		await expect(call(() => Promise.reject(error))).rejects.toMatchObject({
			status: 409,
			message:
				"This project still has 1 task. Delete it before deleting the project.",
		});
	});

	it("answers an unknown code with the generic 500", async () => {
		const error = new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Failed to fetch the tasks.",
		});

		await expect(call(() => Promise.reject(error))).rejects.toMatchObject({
			status: 500,
			errors: {},
		});
	});

	it("rethrows anything that is not an ORPCError, for the hook's network branch", async () => {
		const network = new TypeError("fetch failed");

		await expect(call(() => Promise.reject(network))).rejects.toBe(network);
	});
});

describe("ApiError", () => {
	it("carries the envelope's error line as its message, for alerts and tests", () => {
		expect(new ApiError(404, "That task no longer exists.", {}).message).toBe(
			"That task no longer exists.",
		);
	});

	it("is constructed only from a refusal the API decided on", () => {
		// `call` is the one constructor caller; the shape is pinned so the
		// hook's `state.errors?.title` branch cannot drift from it.
		expect(new ApiError(400, "m", { title: ["e"] }).errors).toEqual({
			title: ["e"],
		});
	});
});
