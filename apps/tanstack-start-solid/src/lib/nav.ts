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
  // A dynamic segment, so it is matched as a pattern below rather than listed.
  ["/projects/:id/edit", "Edit project"],
  ["/tasks", "All tasks"],
  ["/tasks/new", "New task"],
  ["/users", "People"],
  ["/users/new", "New user"],
];

export function resolvePageTitle(pathname: string): string {
  if (!pathname) return "Workspace";

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
