// tests/helpers/render.tsx
//
// A `render` that provides the router (and query) context every TanStack
// component needs.
//
// TanStack's `Link` reads the router out of React context and
// `useRouter`/`useLocation` read it directly, so rendering one of these
// components without a provider throws "Cannot read properties of null".
//
// The forms go one further: `useApiAction` reads the query client
// (`useQueryClient`) to invalidate every query after a mutation, so the
// wrapper provides a fresh client per render as well — the same pair of
// providers the app entry (`src/main.tsx`) mounts.
//
// The wrapper lives here rather than in each test file. `route` sets the URL
// so router-dependent tests (the search field's value, the applied filters)
// can set up the state they are asserting about.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	RouterContextProvider,
} from "@tanstack/react-router";
import {
	type RenderOptions,
	type RenderResult,
	render,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { getRouter } from "@/router";

/**
 * Builds a router over a memory history, so no test needs a dev server.
 *
 * A fresh router per call: the route tree caches loader data per match, and
 * sharing one router across tests would let a cached loader answer a test that
 * expects a cold read.
 */
export function makeTestRouter(initialEntry = "/") {
	const history = createMemoryHistory({ initialEntries: [initialEntry] });

	return getRouter({ history });
}

type Options = Omit<RenderOptions, "wrapper"> & {
	/** The URL the router should start at. */
	route?: string;
};

export function renderWithRouter(
	ui: ReactElement,
	{ route = "/", ...options }: Options = {},
): RenderResult {
	const router = makeTestRouter(route);
	// A fresh client per render: a shared one would let one test's cached
	// queries answer another's, the same sharing hazard `makeTestRouter`
	// documents for loader data.
	const queryClient = new QueryClient();

	function Wrapper({ children }: { children: ReactNode }) {
		// RouterContextProvider, not RouterProvider. The latter renders the
		// current *route match* and ignores its children, so it would replace
		// the component under test with the route tree's own output and the
		// test would be asserting against the wrong tree entirely.
		return (
			<QueryClientProvider client={queryClient}>
				<RouterContextProvider router={router}>
					{children}
				</RouterContextProvider>
			</QueryClientProvider>
		);
	}

	return render(ui, { wrapper: Wrapper, ...options });
}

// Everything else (screen, within, fireEvent, act, waitFor, …) comes straight
// from Testing Library, so a test file's import list stays the same apart
// from `render`.
export * from "@testing-library/react";
