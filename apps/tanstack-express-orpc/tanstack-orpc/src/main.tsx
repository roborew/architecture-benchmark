import { COMMON_ERROR_STATUS_MAP, ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { ApiError } from "@/api/api";

import { getRouter } from "./router";

/**
 * True when the failure is the API's deliberate answer rather than a fault.
 * Reads surface a refusal as an `ORPCError` (the query options call the
 * procedure directly); a write's translated `ApiError` can reach here too.
 */
function isDecidedClientError(error: unknown): boolean {
	if (error instanceof ORPCError) {
		// `code` is open-ended, so the map is widened to a string index; an
		// unlisted code falls back to a 5xx.
		const status =
			(COMMON_ERROR_STATUS_MAP as Record<string, number>)[error.code] ?? 500;
		return status >= 400 && status < 500;
	}

	return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

// One client, shared by the router context (loaders) and the provider
// (components) — see getRouter for why the two must not each build their own.
//
// Retries skip decided errors: TanStack Query retries any thrown error three
// times by default (1s/2s/4s backoff), so a NOT_FOUND — which the detail routes
// turn into the not-found state — would otherwise take ~7s to surface, and the
// post-delete `router.invalidate()` (it re-reads the row just removed) the same.
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: (failureCount, error) =>
				!isDecidedClientError(error) && failureCount < 3,
		},
	},
});
const router = getRouter({ queryClient });

const rootElement = document.getElementById("app");

if (rootElement && !rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}
