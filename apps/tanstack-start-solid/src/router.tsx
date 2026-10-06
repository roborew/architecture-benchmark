// src/router.tsx
import {
	createRouter as createTanStackRouter,
	type RouterHistory,
} from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen";

/**
 * Builds the application router.
 *
 * `history` is injectable rather than hard-coded so tests can supply a memory
 * history and render any route without a dev server — see
 * `tests/helpers/render.tsx`. Production omits it and gets the browser history.
 */
export function getRouter(options: { history?: RouterHistory } = {}) {
	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		// Plain string search params, rather than TanStack's default JSON-ish
		// handling.
		//
		// The default round-trips every value through JSON.parse/stringify, so a
		// value that *looks* like JSON gets quoted on the way out: `?size=5`
		// parsed back as the string "5", then re-serialised as `"5"` — a URL of
		// `?size=%225%22`. Round-tripping was stable but the URLs were not the ones
		// the Next.js app produced, and the e2e suite asserts on them.
		//
		// Values that genuinely need structure (none on this app yet) can still be
		// nested objects; they are simply not JSON-quoted when they are strings.
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

declare module "@tanstack/solid-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
