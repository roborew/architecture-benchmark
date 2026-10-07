import userEvent from "@testing-library/user-event";
import { makeUser } from "@tests/fixtures/builders";
import { renderWithRouter, screen } from "@tests/helpers/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type FormValues, type MutationResult } from "@/api/api";
import { UserForm } from "./user-form";

// The user form used to be inert markup: no `name` attributes and no `<form>`,
// so nothing could ever be submitted. These tests pin the parts that make it a
// real form — named fields, a submit button, and the API's validation state
// rendered against the offending input.
//
// The api mutations are mocked rather than exercised: their behaviour is
// covered by the API's own tests. What is asserted here is the form's contract
// with them — which one is called, and with what.

/** The reply shape every mutation resolves to: `ok` means success. */
type ApiReply = MutationResult;

const createUserMock = vi.fn(
	async (_values: FormValues): Promise<ApiReply> => ({ ok: true }),
);
const updateUserMock = vi.fn(
	async (_id: number, _values: FormValues): Promise<ApiReply> => ({ ok: true }),
);

vi.mock("@/api/users", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/api/users")>();

	// The spread keeps every other export — ApiError included — real, so the
	// rejection paths below can throw the genuine class the hook branches on.
	return {
		...actual,
		createUser: (...args: unknown[]) =>
			createUserMock(...(args as [FormValues])),
		updateUser: (...args: unknown[]) =>
			updateUserMock(...(args as [number, FormValues])),
	};
});

beforeEach(() => {
	createUserMock.mockClear();
	updateUserMock.mockClear();
	createUserMock.mockResolvedValue({ ok: true });
	updateUserMock.mockResolvedValue({ ok: true });
});

describe("UserForm", () => {
	it("renders labelled name and email fields", () => {
		renderWithRouter(<UserForm />);

		expect(screen.getByLabelText("Name")).toBeInTheDocument();
		expect(screen.getByLabelText("Email")).toBeInTheDocument();
	});

	it("uses an email input for the address", () => {
		renderWithRouter(<UserForm />);

		expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
	});

	it("renders a cancel link and a create button", () => {
		renderWithRouter(<UserForm />);

		expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
			"href",
			"/users",
		);
		expect(
			screen.getByRole("button", { name: "Create user" }),
		).toBeInTheDocument();
	});

	it("submits through a form, so the fields actually reach the action", () => {
		const { container } = renderWithRouter(<UserForm />);

		// Both fields need `name`, or the field bag reaching the action is empty.
		expect(container.querySelector("form")).not.toBeNull();
		expect(screen.getByLabelText("Name")).toHaveAttribute("name", "name");
		expect(screen.getByLabelText("Email")).toHaveAttribute("name", "email");
	});

	it("marks the name as required in the markup", () => {
		// The server re-checks, but a required field is cheaper to fail on.
		renderWithRouter(<UserForm />);

		expect(screen.getByLabelText("Name")).toBeRequired();
	});

	it("submits the typed values to the create action", async () => {
		const user = userEvent.setup();
		renderWithRouter(<UserForm />);

		await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
		await user.type(screen.getByLabelText("Email"), "ada@example.test");
		await user.click(screen.getByRole("button", { name: "Create user" }));

		expect(createUserMock).toHaveBeenCalledTimes(1);
		expect(createUserMock).toHaveBeenCalledWith({
			name: "Ada Lovelace",
			email: "ada@example.test",
		});
	});

	describe("server-side validation", () => {
		// A refused submit arrives as a thrown ApiError, so these tests have to
		// submit before the returned state appears. The fields are filled with
		// valid values so the browser's own `required` check does not short
		// circuit the submit — the point is what the form renders from the API's
		// reply, not that the browser blocks bad input first.
		async function submitValidForm() {
			const user = userEvent.setup();
			renderWithRouter(<UserForm />);

			await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
			await user.type(screen.getByLabelText("Email"), "ada@example.test");
			await user.click(screen.getByRole("button", { name: "Create user" }));
		}

		it("shows the API's message in an alert", async () => {
			createUserMock.mockImplementationOnce(() => {
				throw new ApiError(400, "Missing fields. Failed to create user.", {
					email: ["Enter a valid email address."],
				});
			});

			await submitValidForm();

			expect(await screen.findByRole("alert")).toHaveTextContent(
				"Missing fields. Failed to create user.",
			);
		});

		it("shows a field error against the offending input", async () => {
			createUserMock.mockImplementationOnce(() => {
				throw new ApiError(400, "Missing fields. Failed to create user.", {
					email: ["Enter a valid email address."],
				});
			});

			await submitValidForm();

			expect(
				await screen.findByText("Enter a valid email address."),
			).toBeInTheDocument();
			expect(screen.getByLabelText("Email")).toHaveAttribute(
				"aria-invalid",
				"true",
			);
		});

		it("marks the name invalid when the name failed validation", async () => {
			createUserMock.mockImplementationOnce(() => {
				throw new ApiError(400, "Missing fields. Failed to create user.", {
					name: ["User name is required."],
				});
			});

			await submitValidForm();

			expect(
				await screen.findByText("User name is required."),
			).toBeInTheDocument();
			expect(screen.getByLabelText("Name")).toHaveAttribute(
				"aria-invalid",
				"true",
			);
		});

		it("leaves the other field unmarked when only one failed", async () => {
			createUserMock.mockImplementationOnce(() => {
				throw new ApiError(400, "Missing fields. Failed to create user.", {
					name: ["User name is required."],
				});
			});

			await submitValidForm();

			await screen.findByText("User name is required.");
			expect(screen.getByLabelText("Email")).not.toHaveAttribute(
				"aria-invalid",
			);
		});

		it("links the error text to its input for screen readers", async () => {
			createUserMock.mockImplementationOnce(() => {
				throw new ApiError(400, "Missing fields. Failed to create user.", {
					email: ["Enter a valid email address."],
				});
			});

			await submitValidForm();

			await screen.findByText("Enter a valid email address.");
			expect(screen.getByLabelText("Email")).toHaveAttribute(
				"aria-describedby",
				"user-email-error",
			);
		});

		it("keeps what was typed when the submit is rejected", async () => {
			createUserMock.mockImplementationOnce(() => {
				throw new ApiError(400, "Missing fields. Failed to create user.", {
					name: ["User name is required."],
				});
			});

			const user = userEvent.setup();
			renderWithRouter(<UserForm />);

			await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
			await user.type(screen.getByLabelText("Email"), "ada@example.test");
			await user.click(screen.getByRole("button", { name: "Create user" }));

			await screen.findByText("User name is required.");
			// A rejected submit must not wipe the user's input.
			expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
		});
	});

	describe("editing", () => {
		const person = makeUser({ id: 42, name: "Ada Lovelace" });

		it("prefills the fields from the stored row", () => {
			renderWithRouter(<UserForm person={person} />);

			expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
			expect(screen.getByLabelText("Email")).toHaveValue(person.email);
		});

		it("heads the page and the button for an edit", () => {
			renderWithRouter(<UserForm person={person} />);

			expect(
				screen.getByRole("heading", { name: "Edit user" }),
			).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: "Save changes" }),
			).toBeInTheDocument();
		});

		it("cancels back to the member's own page", () => {
			renderWithRouter(<UserForm person={person} />);

			expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
				"href",
				`/users/${person.id}`,
			);
		});

		it("submits the edited values with the row id in the closure", async () => {
			const user = userEvent.setup();
			renderWithRouter(<UserForm person={person} />);

			await user.clear(screen.getByLabelText("Name"));
			await user.type(screen.getByLabelText("Name"), "Ada King");
			await user.click(screen.getByRole("button", { name: "Save changes" }));

			expect(updateUserMock).toHaveBeenCalledTimes(1);
			// The row being edited is identified by the closure's id, not by a
			// form field: the API's update URL carries it.
			expect(updateUserMock).toHaveBeenCalledWith(person.id, {
				name: "Ada King",
				email: person.email,
			});
		});

		it("does not submit to the create action when editing", () => {
			renderWithRouter(<UserForm person={person} />);

			expect(createUserMock).not.toHaveBeenCalled();
		});
	});
});
