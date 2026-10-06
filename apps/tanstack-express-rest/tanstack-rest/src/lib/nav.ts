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
