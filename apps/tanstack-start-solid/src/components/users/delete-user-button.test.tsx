import userEvent from "@testing-library/user-event";
import { makeUser } from "@tests/fixtures/builders";
import { renderWithRouter, screen } from "@tests/helpers/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteUserButton } from "./delete-user-button";

type MutationArgs = [payload: { data: FormData }];

type ActionReply = {
	redirectTo?: string;
	message?: string;
	errors?: Record<string, string[]>;
};

const deleteUserFn = vi.fn(
	async (_payload: MutationArgs[0]): Promise<ActionReply> => ({}),
);

vi.mock("@/server/mutations", () => ({
	ID_FIELD: { project: "projectId", task: "taskId", user: "userId" },
	deleteUserFn: (...args: unknown[]) => deleteUserFn(...(args as MutationArgs)),
}));

vi.mock("@tanstack/solid-start", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/solid-start")>();
	return { ...actual, useServerFn: (fn: unknown) => fn };
});

beforeEach(() => {
	deleteUserFn.mockClear();
	deleteUserFn.mockResolvedValue({ redirectTo: "/users" });
});

describe("DeleteUserButton", () => {
	const person = makeUser({ id: 7, name: "Alex Morgan" });

	it("names the member in its accessible label", () => {
		renderWithRouter(() => <DeleteUserButton person={person} />);

		const button = screen.getByRole("button", { name: /Delete Alex Morgan/ });

		expect(button).toBeInTheDocument();
		expect(button).toHaveAccessibleName(/7/);
	});

	it("submits a form, so the delete works without client state", () => {
		const { container } = renderWithRouter(() => (
			<DeleteUserButton person={person} />
		));

		expect(container.querySelector("form")).not.toBeNull();
	});

	it("submits the delete when activated", async () => {
		const user = userEvent.setup();
		renderWithRouter(() => <DeleteUserButton person={person} />);

		await user.click(
			screen.getByRole("button", { name: /Delete Alex Morgan/ }),
		);

		expect(deleteUserFn).toHaveBeenCalledTimes(1);
		const { data } = deleteUserFn.mock.calls[0][0];
		expect(data.get("userId")).toBe("7");
	});

	it("reports the message the action returned", async () => {
		deleteUserFn.mockResolvedValue({
			message: "This person still has 2 comments and 2 tasks.",
		});

		const user = userEvent.setup();
		renderWithRouter(() => <DeleteUserButton person={person} />);

		await user.click(
			screen.getByRole("button", { name: /Delete Alex Morgan/ }),
		);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"This person still has 2 comments and 2 tasks.",
		);
	});

	it("shows no alert when the action reported no problem", async () => {
		const user = userEvent.setup();
		renderWithRouter(() => <DeleteUserButton person={person} />);

		await user.click(
			screen.getByRole("button", { name: /Delete Alex Morgan/ }),
		);

		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("disables itself while the delete is in flight", async () => {
		let settle: (value: ActionReply) => void = () => {};
		deleteUserFn.mockReturnValueOnce(
			new Promise((resolve) => {
				settle = resolve;
			}),
		);

		const user = userEvent.setup();
		renderWithRouter(() => <DeleteUserButton person={person} />);

		await user.click(
			screen.getByRole("button", { name: /Delete Alex Morgan/ }),
		);

		expect(
			screen.getByRole("button", { name: /Delete Alex Morgan/ }),
		).toBeDisabled();

		settle({});
	});
});
