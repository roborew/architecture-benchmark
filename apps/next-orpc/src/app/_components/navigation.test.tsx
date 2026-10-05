import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Navigation from "./navigation";
import { NAV_ITEMS } from "@/lib/nav";

const usePathname = vi.fn(() => "/");

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

describe("Navigation", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
  });

  it("renders a nav landmark", () => {
    render(<Navigation />);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("links the brand to the dashboard", () => {
    render(<Navigation />);

    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("renders one link per nav item", () => {
    render(<Navigation />);

    const nav = screen.getByRole("navigation");

    expect(within(nav).getAllByRole("link")).toHaveLength(NAV_ITEMS.length);
  });

  NAV_ITEMS.forEach((item) => {
    it(`links to ${item.href} with the label "${item.label}"`, () => {
      render(<Navigation />);

      const nav = screen.getByRole("navigation");
      const link = within(nav).getByRole("link", { name: item.label });

      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", item.href);
    });
  });

  it("renders the links in NAV_ITEMS order", () => {
    render(<Navigation />);

    const nav = screen.getByRole("navigation");
    // The brand link sits outside <nav>, so every link in here is a nav item.
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      NAV_ITEMS.map((item) => item.href),
    );
  });

  it("marks the current page with aria-current", () => {
    usePathname.mockReturnValue("/projects");

    render(<Navigation />);

    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks the dashboard on the root path", () => {
    usePathname.mockReturnValue("/");

    render(<Navigation />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not mark a page when the path does not match", () => {
    usePathname.mockReturnValue("/users");

    render(<Navigation />);

    expect(screen.getByRole("link", { name: "Projects" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
