import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type FormValues, type MutationResult } from "@/lib/api";
import { getRouter } from "@/router";
import { formValues, useApiAction } from "./use-api-action";

// The bridge between a form and the REST API, in the shape of the reference
// variant's `useServerAction` (apps/tanstack-start-react/src/hooks/
// use-server-action.ts). These tests pin the protocol: which state a form
// renders, and exactly when the cache is invalidated and the router navigated
// — the ordering the reference documents ("invalidate before navigating").

type ActionFn = (values: FormValues) => Promise<MutationResult>;

/** A wrapper giving the hook the same providers the app entry does. */
function makeWrapper() {
	const queryClient = new QueryClient();
	const router = getRouter({ queryClient });

	return {
		queryClient,
		router,
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>
				<RouterContextProvider router={router}>
					{children}
				</RouterContextProvider>
			</QueryClientProvider>
		),
	};
}

function renderAction(action: ActionFn) {
	const { queryClient, router, wrapper } = makeWrapper();
	const spies = {
		invalidateQueries: vi.spyOn(queryClient, "invalidateQueries"),
		invalidateRouter: vi.spyOn(router, "invalidate"),
		navigate: vi.spyOn(router, "navigate"),
	};
	const rendered = renderHook(() => useApiAction(action), { wrapper });

	return { ...rendered, spies, router };
}

const success = (redirectTo?: string): MutationResult =>
	redirectTo === undefined
		? { ok: true }
		: { ok: true, message: "Task created.", redirectTo };

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("formValues", () => {
	it("reads a form's fields as the strings the api client sends", () => {
		const formData = new FormData();
		formData.set("title", "Draft the model");
		formData.set("assigneeId", "");
		formData.set("status", "todo");

		expect(formValues(formData)).toEqual({
			title: "Draft the model",
			assigneeId: "",
			status: "todo",
		});
	});
});

describe("useApiAction", () => {
	it("submits the form's values to the action it was given", async () => {
		const action = vi.fn().mockResolvedValue(success("/tasks/9"));
		const { result, spies } = renderAction(action);

		const formData = new FormData();
		formData.set("title", "Draft the model");
		formData.set("status", "todo");

		result.current[1](formData);

		await waitFor(() => expect(result.current[0]).toEqual({}));
		expect(action).toHaveBeenCalledWith({
			title: "Draft the model",
			status: "todo",
		});
		expect(spies.invalidateQueries).toHaveBeenCalled();
	});

	it("invalidates, then navigates to the redirect target", async () => {
		const action = vi.fn().mockResolvedValue(success("/tasks/9"));
		const { result, spies } = renderAction(action);

		result.current[1](new FormData());

		await waitFor(() => expect(result.current[0]).toEqual({}));

		// The order is the contract: the cache must be stale before the router
		// re-runs its loaders, and the navigation happens only after both —
		// navigating first would render the stale list and then re-render under
		// the user with the new row.
		expect(spies.invalidateQueries.mock.invocationCallOrder[0]).toBeLessThan(
			spies.invalidateRouter.mock.invocationCallOrder[0],
		);
		expect(spies.navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: "/tasks/9" }),
		);
	});

	it("invalidates and stays on the page when there is no redirect", async () => {
		// Adding a comment replies without a redirectTo: the user stays on the
		// detail page, but the comment list must still refresh.
		const action = vi.fn().mockResolvedValue(success());
		const { result, spies } = renderAction(action);

		result.current[1](new FormData());

		await waitFor(() => expect(result.current[0]).toEqual({}));
		expect(spies.invalidateQueries).toHaveBeenCalled();
		expect(spies.invalidateRouter).toHaveBeenCalled();
		expect(spies.navigate).not.toHaveBeenCalled();
	});

	it("renders the API's field errors without invalidating anything", async () => {
		// A validation failure is not a mutation: the route's data is still
		// correct, so re-running the loaders would only cost a round trip.
		const action = vi.fn().mockImplementation(() => {
			throw new ApiError(400, "Missing fields. Failed to create task.", {
				title: ["Title is required."],
			});
		});
		const { result, spies } = renderAction(action);

		result.current[1](new FormData());

		await waitFor(() =>
			expect(result.current[0]).toEqual({
				message: "Missing fields. Failed to create task.",
				errors: { title: ["Title is required."] },
			}),
		);
		expect(spies.invalidateQueries).not.toHaveBeenCalled();
		expect(spies.invalidateRouter).not.toHaveBeenCalled();
		expect(spies.navigate).not.toHaveBeenCalled();
	});

	it("renders a guard message from a 409 as plain state", async () => {
		const action = vi.fn().mockImplementation(() => {
			throw new ApiError(409, "Delete the project's tasks first.", {});
		});
		const { result, spies } = renderAction(action);

		result.current[1](new FormData());

		await waitFor(() =>
			expect(result.current[0]).toEqual({
				message: "Delete the project's tasks first.",
			}),
		);
		expect(spies.navigate).not.toHaveBeenCalled();
	});

	it("renders a network failure's message rather than rejecting silently", async () => {
		const action = vi.fn().mockImplementation(() => {
			throw new TypeError("Failed to fetch");
		});
		const { result } = renderAction(action);

		result.current[1](new FormData());

		await waitFor(() =>
			expect(result.current[0]).toEqual({ message: "Failed to fetch" }),
		);
	});
});
