import userEvent from "@testing-library/user-event";
import { makeUser } from "@tests/fixtures/builders";
import { renderWithRouter, screen } from "@tests/helpers/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type MutationResult } from "@/api/api";
import { DeleteUserButton } from "./delete-user-button";

// Mirrors DeleteProjectButton: a form whose bound action does the work, plus
// an alert region for the message the API returns when a foreign key blocks
// the delete. The action's behaviour is covered by the API's own tests.

/** The reply shape every mutation resolves to: `ok` means success. */
type ApiReply = MutationResult;

const deleteUserMock = vi.fn(
	async (_id: number): Promise<ApiReply> => ({ ok: true }),
);

vi.mock("@/api/users", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/api/users")>();

	// The spread keeps every other export — ApiError included — real, so the
	// guard-message test below can throw the genuine class the hook branches on.
	return {
		...actual,
		deleteUser: (...args: unknown[]) => deleteUserMock(...(args as [number])),
	};
});

beforeEach(() => {
	deleteUserMock.mockClear();
	deleteUserMock.mockResolvedValue({ ok: true });
});

describe("DeleteUserButton", () => {
	const person = makeUser({ id: 7, name: "Alex Morgan" });

	it("names the member in its accessible label", () => {
		// Two members can share a display name, so the control has to identify its
		// row — otherwise a screen-reader user hears the same label twice.
		renderWithRouter(<DeleteUserButton person={person} />);

		const button = screen.getByRole("button", { name: /Delete Alex Morgan/ });

		expect(button).toBeInTheDocument();
		expect(button).toHaveAccessibleName(/7/);
	});

	it("submits a form, so the delete works without client state", () => {
		const { container } = renderWithRouter(
			<DeleteUserButton person={person} />,
		);

		expect(container.querySelector("form")).not.toBeNull();
	});

	it("submits the delete with the row id in the closure", async () => {
		const user = userEvent.setup();
		renderWithRouter(<DeleteUserButton person={person} />);

		await user.click(
			screen.getByRole("button", { name: /Delete Alex Morgan/ }),
		);

		expect(deleteUserMock).toHaveBeenCalledTimes(1);
		// The row is identified by the closure's id, not by a form field: the
		// API's delete URL carries it.
		expect(deleteUserMock).toHaveBeenCalledWith(person.id);
	});

	it("reports the message the API returned", async () => {
		// A member who authored comments cannot be deleted (a 409 from the API,
		// which carries only a message); the reason has to reach the screen
		// rather than being swallowed.
		deleteUserMock.mockImplementationOnce(() => {
			throw new ApiError(
				409,
				"This person still has 2 comments and 2 tasks.",
				{},
			);
		});

		const user = userEvent.setup();
		renderWithRouter(<DeleteUserButton person={person} />);

		await user.click(
			screen.getByRole("button", { name: /Delete Alex Morgan/ }),
		);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"This person still has 2 comments and 2 tasks.",
		);
	});

	it("shows no alert when the action reported no problem", async () => {
		const user = userEvent.setup();
		renderWithRouter(<DeleteUserButton person={person} />);

		await user.click(
			screen.getByRole("button", { name: /Delete Alex Morgan/ }),
		);

		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("disables itself while the delete is in flight", async () => {
		let settle: (value: ApiReply) => void = () => {};
		deleteUserMock.mockReturnValueOnce(
			new Promise((resolve) => {
				settle = resolve;
			}),
		);

		const user = userEvent.setup();
		renderWithRouter(<DeleteUserButton person={person} />);

		await user.click(
			screen.getByRole("button", { name: /Delete Alex Morgan/ }),
		);

		// A second click would submit the delete twice.
		expect(
			screen.getByRole("button", { name: /Delete Alex Morgan/ }),
		).toBeDisabled();

		// Settling without a redirect keeps the transition off the router, so
		// the in-flight assertion above is all this test depends on.
		settle({ ok: true });
	});
});
