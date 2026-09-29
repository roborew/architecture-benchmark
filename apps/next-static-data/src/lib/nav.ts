export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "⌂" },
  { href: "/projects", label: "Projects", icon: "▦" },
  { href: "/tasks", label: "All tasks", icon: "☷" },
  { href: "/users", label: "People", icon: "◉" },
] as const;

// Mirrors the `pageTitles` map in the reference HTML. Dynamic routes
// (project/task/user detail) resolve to "Workspace" for now; those
// stages pass their own title once their routes exist.
const PAGE_TITLES: Array<[string, string]> = [
  ["/", "Dashboard"],
  ["/projects", "Projects"],
  ["/projects/new", "New project"],
  ["/tasks", "All tasks"],
  ["/tasks/new", "New task"],
  ["/users", "People"],
  ["/users/new", "New user"],
];

export function resolvePageTitle(pathname: string): string {
  return PAGE_TITLES.find(([href]) => href === pathname)?.[1] ?? "Workspace";
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href;
}
