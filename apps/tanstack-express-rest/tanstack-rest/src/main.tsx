import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { getRouter } from "./router";

// One client, shared by the router context (loaders) and the provider
// (components) — see getRouter for why the two must not each build their own.
const queryClient = new QueryClient();
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
