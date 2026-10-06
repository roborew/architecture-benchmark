import {
	act,
	fireEvent,
	renderWithRouter,
	screen,
} from "@tests/helpers/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchInput } from "./search-input";

// Mutable so a test can change the URL underneath the component, which is
// how back/forward and shared links arrive. vi.hoisted is required: the
// mock factory is lifted above these declarations, so it would otherwise
// close over them before initialisation.
//
// `router` must be ONE object, not a fresh literal per call. SearchInput keeps
// `router` in a useEffect dependency array, so a new identity every render makes
// the effect re-run after each commit; it calls startTransition, which renders
// again, which builds another router. The `query === urlQuery.trim()` guard
// cannot break that cycle: router.navigate is a no-op here, so the mocked search
// params never move and urlQuery stays "" forever. Under vi.useFakeTimers() the
// loop never yields and the worker spins until it is killed.
const mocks = vi.hoisted(() => {
	const navigate = vi.fn();

	return {
		navigate,
		// Stable identity, and the same spy the tests assert against, so
		// mockClear() in beforeEach still covers every navigation.
		router: { navigate },
		params: new URLSearchParams(),
		pathname: "/users",
	};
});

// Only the two hooks are stubbed. The rest of the module stays real, so the
// rendered tree still gets TanStack's own exports.
//
// useLocation mirrors TanStack's ParsedLocation: the component reads the query
// off the raw `searchStr`, so the mocked `params` are stringified into it.
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		useRouter: () => mocks.router,
		useLocation: () => ({
			pathname: mocks.pathname,
			searchStr: mocks.params.toString(),
		}),
	};
});

// The debounce lives in a real timer, and startTransition needs a React
// commit to flip isPending, so time only advances inside act().
async function settle(ms = 300) {
	await act(async () => {
		vi.advanceTimersByTime(ms);
	});
}

// fireEvent rather than userEvent: userEvent awaits its own inter-key
// delays, which never resolve under fake timers, so every awaited call
// hangs until the test times out. Typing is simulated directly instead.
function type(text: string) {
	fireEvent.change(screen.getByRole("searchbox"), { target: { value: text } });
}

describe("SearchInput", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.navigate.mockClear();
		mocks.params = new URLSearchParams();
		mocks.pathname = "/users";
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const input = () => screen.getByRole("searchbox");

	it("labels the field for screen readers", () => {
		renderWithRouter(<SearchInput label="Search people" />);

		expect(input()).toHaveAccessibleName("Search people");
	});

	it("seeds the field from the q param already in the URL", () => {
		mocks.params = new URLSearchParams("q=alpha");

		renderWithRouter(<SearchInput />);

		expect(input()).toHaveValue("alpha");
	});

	it("does not navigate before the debounce elapses", async () => {
		renderWithRouter(<SearchInput />);

		type("alpha");
		await settle(299);

		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it("writes the query to the URL once the debounce elapses", async () => {
		renderWithRouter(<SearchInput />);

		type("alpha");
		await settle();

		// The query is passed as structured `search`, not embedded in the path.
		// TanStack only runs a route's validateSearch over `search`, so a
		// pre-joined "/users?q=alpha" would leave the query invisible to the
		// loader and the list would silently render unfiltered.
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/users",
			search: { q: "alpha" },
			replace: true,
			resetScroll: false,
		});
	});

	it("collapses a burst of typing into a single navigation", async () => {
		renderWithRouter(<SearchInput />);

		// Each keystroke restarts the timer; only the final value survives.
		type("a");
		await settle(100);
		type("al");
		await settle(100);
		type("alpha");
		await settle();

		expect(mocks.navigate).toHaveBeenCalledTimes(1);
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/users",
			search: { q: "alpha" },
			replace: true,
			resetScroll: false,
		});
	});

	it("keeps the trailing space while typing a second word", async () => {
		renderWithRouter(<SearchInput />);

		type("alpha ");
		await settle();
		type("alpha beta");
		await settle();

		// The URL is trimmed but the visible field must not be, otherwise
		// "alpha beta" collapses to "alphabeta" while it is being typed.
		expect(input()).toHaveValue("alpha beta");
		expect(mocks.navigate).toHaveBeenLastCalledWith({
			to: "/users",
			// The value is the decoded term: structured `search` carries the space
			// as itself, and TanStack is what encodes it into the URL.
			search: { q: "alpha beta" },
			replace: true,
			resetScroll: false,
		});
	});

	it("holds off until the query is long enough to be worth a round trip", async () => {
		renderWithRouter(<SearchInput />);

		type("a");
		await settle();

		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it("navigates to the bare path when the field is cleared", async () => {
		mocks.params = new URLSearchParams("q=alpha");
		renderWithRouter(<SearchInput />);

		type("");
		await settle();

		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/users",
			search: undefined,
			replace: true,
			resetScroll: false,
		});
	});

	it("preserves unrelated params already in the URL", async () => {
		mocks.params = new URLSearchParams("status=done");
		renderWithRouter(<SearchInput />);

		type("alpha");
		await settle();

		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/users",
			search: { status: "done", q: "alpha" },
			replace: true,
			resetScroll: false,
		});
	});

	it("adopts a query that arrives from outside, as on back/forward", () => {
		const { rerender } = renderWithRouter(<SearchInput />);

		mocks.params = new URLSearchParams("q=beta");
		rerender(<SearchInput />);

		expect(input()).toHaveValue("beta");
	});

	it("does not clobber typing when its own navigation echoes back", async () => {
		const { rerender } = renderWithRouter(<SearchInput />);

		type("alpha");
		await settle();

		// The router settles the URL with the trimmed value we sent.
		mocks.params = new URLSearchParams("q=alpha");
		rerender(<SearchInput />);

		expect(input()).toHaveValue("alpha");
	});

	it("drives the param name it is given", async () => {
		renderWithRouter(<SearchInput param="name" />);

		type("alpha");
		await settle();

		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/users",
			search: { name: "alpha" },
			replace: true,
			resetScroll: false,
		});
	});
});
