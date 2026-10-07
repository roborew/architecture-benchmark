export const NAV_ITEMS = [
	{ href: "/", label: "Dashboard", icon: "⌂" },
	{ href: "/projects", label: "Projects", icon: "▦" },
	{ href: "/tasks", label: "All tasks", icon: "☷" },
	{ href: "/users", label: "People", icon: "◉" },
] as const;

// Mirrors the `pageTitles` map in the reference app
// (apps/tanstack-start-react/src/lib/nav.ts). Detail pages (project/task/user)
// resolve to "Workspace" through the fallback below, exactly as they do
// there.
const PAGE_TITLES: Array<[string, string]> = [
	["/", "Dashboard"],
	["/projects", "Projects"],
	["/projects/new", "New project"],
	// A dynamic segment, so it is matched as a pattern below rather than listed.
	["/projects/:id/edit", "Edit project"],
	["/tasks", "All tasks"],
	["/tasks/new", "New task"],
	["/users", "People"],
	["/users/new", "New user"],
];

export function resolvePageTitle(pathname: string): string {
	const exact = PAGE_TITLES.find(([href]) => href === pathname);

	if (exact) {
		return exact[1];
	}

	// `:id` stands in for any single segment, which is how a dynamic route like
	// `/projects/12/edit` resolves without hard-coding an id.
	const patterned = PAGE_TITLES.find(([href]) =>
		href
			.split("/")
			.every(
				(segment, index) =>
					segment.startsWith(":") || segment === pathname.split("/")[index],
			),
	);

	return patterned?.[1] ?? "Workspace";
}

export function isActivePath(pathname: string, href: string): boolean {
	return pathname === href;
}

// The routes the route tree actually registers. A nav entry for an unbuilt
// route renders as a plain anchor — a router Link to an unregistered route
// throws on render — so the menu can ship the full template before every
// route exists. As each slice lands, add its path here and the anchor becomes
// a Link.
const BUILT_PATHS = new Set([
	"/",
	"/projects",
	"/projects/new",
	"/projects/$id",
	"/projects/$id/edit",
	"/tasks",
	"/tasks/new",
	"/tasks/$id",
	"/tasks/$id/edit",
	"/users",
	"/users/new",
	"/users/$id",
	"/users/$id/edit",
]);

export function isBuiltPath(href: string): boolean {
	return BUILT_PATHS.has(href);
}
