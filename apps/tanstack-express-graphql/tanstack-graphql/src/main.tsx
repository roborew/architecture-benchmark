import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { ApiError } from "@/api/api";

import { getRouter } from "./router";

/**
 * The API's deliberate refusals are a 4xx — a decided outcome, not a transient
 * fault. Only a 5xx or a dropped connection is worth retrying.
 */
function isDecidedClientError(error: unknown): boolean {
	return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

// One client, shared by the router context (loaders) and the provider
// (components) — see getRouter for why the two must not each build their own.
//
// Retries skip decided errors: TanStack Query retries any thrown error three
// times by default (1s/2s/4s backoff), so a 404 — which the detail routes turn
// into the not-found state — would otherwise take ~7s to surface, and the
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
