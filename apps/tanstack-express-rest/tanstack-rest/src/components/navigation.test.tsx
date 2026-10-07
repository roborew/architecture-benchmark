import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isBuiltPath, NAV_ITEMS } from "@/lib/nav";
import Navigation from "./navigation";

// vi.hoisted is required: the mock factory is lifted above this declaration,
// so it could not otherwise close over them. The pathname is mutable so a test
// can assert which nav item is the current one.
const mocks = vi.hoisted(() => ({ usePathname: vi.fn(() => "/") }));

// Navigation has no router of its own — it only reads the current pathname —
// so useLocation is the single hook stubbed here. TanStack's Link is left real,
// because the rendered tree needs it to produce hrefs off the real router.
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();

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
		renderWithRouter(<Navigation />);

		expect(screen.getByRole("navigation")).toBeInTheDocument();
	});

	it("links the brand to the dashboard", () => {
		renderWithRouter(<Navigation />);

		expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute(
			"href",
			"/",
		);
	});

	it("renders one menu entry per nav item, built or not", () => {
		renderWithRouter(<Navigation />);

		const nav = screen.getByRole("navigation");

		// Unbuilt routes render as plain anchors rather than router Links — a
		// Link to a route the tree does not register throws on render — but
		// they are still menu entries, so the template is complete.
		expect(within(nav).getAllByRole("link")).toHaveLength(NAV_ITEMS.length);
	});

	NAV_ITEMS.forEach((item) => {
		it(`links to ${item.href} with the label "${item.label}"`, () => {
			renderWithRouter(<Navigation />);

			const nav = screen.getByRole("navigation");
			const link = within(nav).getByRole("link", { name: item.label });

			expect(link).toBeInTheDocument();
			expect(link).toHaveAttribute("href", item.href);
		});
	});

	it("renders the links in NAV_ITEMS order", () => {
		renderWithRouter(<Navigation />);

		const nav = screen.getByRole("navigation");
		// The brand link sits outside <nav>, so every link in here is a nav item.
		const links = within(nav).getAllByRole("link");

		expect(links.map((link) => link.getAttribute("href"))).toEqual(
			NAV_ITEMS.map((item) => item.href),
		);
	});

	it("marks the current page with aria-current", () => {
		mocks.usePathname.mockReturnValue("/users");

		renderWithRouter(<Navigation />);

		expect(screen.getByRole("link", { name: "People" })).toHaveAttribute(
			"aria-current",
			"page",
		);
	});

	it("marks the dashboard on the root path", () => {
		mocks.usePathname.mockReturnValue("/");

		renderWithRouter(<Navigation />);

		expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
			"aria-current",
			"page",
		);
	});

	it("does not mark a page when the path does not match", () => {
		mocks.usePathname.mockReturnValue("/users");

		renderWithRouter(<Navigation />);

		expect(screen.getByRole("link", { name: "Projects" })).not.toHaveAttribute(
			"aria-current",
		);
	});

	it("marks only routes the tree actually registers as built", () => {
		// The guard that keeps unbuilt entries as anchors; every nav entry's
		// route has landed now, so all four are Links.
		expect(isBuiltPath("/")).toBe(true);
		expect(isBuiltPath("/projects")).toBe(true);
		expect(isBuiltPath("/tasks")).toBe(true);
		expect(isBuiltPath("/users")).toBe(true);
	});
});
