import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { AppShell } from "@/components/app-shell";

import "../styles.css";

/**
 * What every route's loader receives through `context`.
 *
 * The queryClient is handed in by the entry (`src/main.tsx`) so the loaders
 * (ensureQueryData) and the components (useQuery) share one cache — declared
 * here because the root route is what the router's context type is inferred
 * from.
 */
export interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootComponent,
});

function RootComponent() {
	return (
		<>
			{/* The shell carries the page chrome — header, title — and wraps
					every route. */}
			<AppShell>
				<Outlet />
			</AppShell>
			<TanStackDevtools
				config={{
					position: "bottom-right",
				}}
				plugins={[
					{
						name: "TanStack Router",
						render: <TanStackRouterDevtoolsPanel />,
					},
				]}
			/>
		</>
	);
}
