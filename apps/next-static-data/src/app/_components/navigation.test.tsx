import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Navigation from "./navigation";
import { NAV_ITEMS } from "@/lib/nav";

describe("Navigation", () => {
  it("renders a nav landmark", () => {
    render(<Navigation />);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
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
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      NAV_ITEMS.map((item) => item.href),
    );
  });
});
