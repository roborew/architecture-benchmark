import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import Navigation from "./navigation";
import { NAV_ITEMS } from "@/lib/nav";

const mocks = vi.hoisted(() => ({ usePathname: vi.fn(() => "/") }));

vi.mock("@tanstack/solid-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/solid-router")>();

  return {
    ...actual,
    useLocation: () => ({ pathname: mocks.usePathname(), searchStr: "" }),
  };
});

describe("Navigation", () => {
  beforeEach(() => {
    mocks.usePathname.mockReturnValue("/");
  });

  it("renders a nav landmark", () => {
    renderWithRouter(() => <Navigation />);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("links the brand to the dashboard", () => {
    renderWithRouter(() => <Navigation />);

    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("renders one link per nav item", () => {
    renderWithRouter(() => <Navigation />);

    const nav = screen.getByRole("navigation");

    expect(within(nav).getAllByRole("link")).toHaveLength(NAV_ITEMS.length);
  });

  NAV_ITEMS.forEach((item) => {
    it(`links to ${item.href} with the label "${item.label}"`, () => {
      renderWithRouter(() => <Navigation />);

      const nav = screen.getByRole("navigation");
      const link = within(nav).getByRole("link", { name: item.label });

      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", item.href);
    });
  });

  it("renders the links in NAV_ITEMS order", () => {
    renderWithRouter(() => <Navigation />);

    const nav = screen.getByRole("navigation");
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      NAV_ITEMS.map((item) => item.href),
    );
  });

  it("marks the current page with aria-current", () => {
    renderWithRouter(() => <Navigation />, { route: "/projects" });

    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks the dashboard on the root path", () => {
    renderWithRouter(() => <Navigation />, { route: "/" });

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not mark a page when the path does not match", () => {
    renderWithRouter(() => <Navigation />, { route: "/users" });

    expect(screen.getByRole("link", { name: "Projects" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
