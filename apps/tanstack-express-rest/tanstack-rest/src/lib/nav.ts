export const NAV_ITEMS = [
	{ href: "/", label: "Dashboard", icon: "⌂" },
	{ href: "/projects", label: "Projects", icon: "▦" },
	{ href: "/tasks", label: "All tasks", icon: "☷" },
	{ href: "/users", label: "People", icon: "◉" },
] as const;

// Mirrors the `pageTitles` map in the reference app. Only the routes that
// exist so far are listed; later slices add their own entries.
const PAGE_TITLES: Array<[string, string]> = [
	["/", "Dashboard"],
	["/tasks", "All tasks"],
	["/users", "People"],
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
const BUILT_PATHS = new Set(["/", "/tasks", "/users"]);

export function isBuiltPath(href: string): boolean {
	return BUILT_PATHS.has(href);
}
