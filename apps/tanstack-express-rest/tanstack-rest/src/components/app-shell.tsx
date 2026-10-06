import { useLocation } from "@tanstack/react-router";
import { resolvePageTitle } from "@/lib/nav";
import { AppHeader } from "./app-header";

// The page chrome — header and content column. The reference app's sidebar
// navigation lands with the routes it links to (projects, tasks); a sidebar
// of dead links would render a route the router cannot resolve.
export function AppShell({ children }: { children: React.ReactNode }) {
	const pathname = useLocation().pathname;

	return (
		<div className="flex min-h-screen flex-col bg-slate-50">
			<AppHeader title={resolvePageTitle(pathname)} />
			<main className="min-w-0 flex-1 bg-white">{children}</main>
		</div>
	);
}
