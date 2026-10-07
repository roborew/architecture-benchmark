import { QueryClient } from "@tanstack/react-query";
import {
	createRouter as createTanStackRouter,
	type RouterHistory,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * Builds the application router.
 *
 * `history` is injectable rather than hard-coded so tests can supply a memory
 * history and render any route without a dev server — see
 * `tests/helpers/render.tsx`. Production omits it and gets the browser history.
 *
 * `queryClient` is likewise injectable so the entry (`src/main.tsx`) can create
 * one client and hand the same instance to both the router context (for
 * loaders) and the React provider (for components) — the two must share one
 * cache or a loader's prefetch is invisible to the page.
 */
export function getRouter(
	options: { history?: RouterHistory; queryClient?: QueryClient } = {},
) {
	const queryClient = options.queryClient ?? new QueryClient();

	const router = createTanStackRouter({
		routeTree,
		context: { queryClient },
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		// Plain string search params, rather than TanStack's default JSON-ish
		// handling.
		//
		// The default round-trips every value through JSON.parse/stringify, so a
		// value that *looks* like JSON gets quoted on the way out: `?q=5`
		// parsed back as the string "5", then re-serialised as `"5"` — a URL of
		// `?q=%225%22`. Round-tripping was stable but the URLs were not the ones
		// the reference app produced, and the e2e suite asserts on them.
		parseSearch: (searchStr: string) =>
			Object.fromEntries(new URLSearchParams(searchStr)),
		stringifySearch: (search: Record<string, unknown>) => {
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(search)) {
				if (value !== undefined && value !== null)
					params.set(key, String(value));
			}
			const str = params.toString();
			return str ? `?${str}` : "";
		},
		...(options.history ? { history: options.history } : {}),
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
