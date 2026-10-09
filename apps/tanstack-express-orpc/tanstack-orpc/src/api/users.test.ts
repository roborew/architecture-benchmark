import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUser, deleteUser, updateUser } from "./users";

// The write half of the users api, exercised against a stubbed oRPC client:
// which procedure each mutation reaches, and the input it carries (the form's
// field bag verbatim, plus the id the caller closed over — under REST the id
// rode in the URL). The reads (the listing, a member and her tasks) are the
// query options' own procedures now (src/queries/users-query.ts).

const { usersMock } = vi.hoisted(() => ({
	usersMock: {
		create: vi.fn(),
		update: vi.fn(),
		remove: vi.fn(),
	},
}));

vi.mock("@/orpc/client", () => ({ client: { users: usersMock } }));

beforeEach(() => {
	for (const fn of Object.values(usersMock)) fn.mockReset();
});

describe("createUser", () => {
	it("sends the form's field bag to users.create, verbatim", async () => {
		usersMock.create.mockResolvedValue({ ok: true, redirectTo: "/users/4" });

		const values = { name: "New Person", email: "new@example.test" };

		await expect(createUser(values)).resolves.toEqual({
			ok: true,
			redirectTo: "/users/4",
		});

		expect(usersMock.create).toHaveBeenCalledWith(values);
	});
});

describe("updateUser", () => {
	it("sends the field bag plus the id to users.update", async () => {
		usersMock.update.mockResolvedValue({ ok: true });

		const values = { name: "Renamed", email: "renamed@example.test" };

		await updateUser(1, values);

		expect(usersMock.update).toHaveBeenCalledWith({ id: 1, ...values });
	});
});

describe("deleteUser", () => {
	it("sends the id alone to users.remove", async () => {
		usersMock.remove.mockResolvedValue({ ok: true });

		await deleteUser(3);

		expect(usersMock.remove).toHaveBeenCalledWith({ id: 3 });
	});
});
