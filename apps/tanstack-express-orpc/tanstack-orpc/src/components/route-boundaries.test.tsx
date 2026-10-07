import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { RouteError } from "./route-error";
import { NotFoundPage } from "./route-not-found";

// The root route's boundary components: the not-found page for a URL that
// matches no route, and the default error component for a route whose loader
// fails without its own errorComponent. Both render inside the shell — a
// boundary page must keep the template (header, sidebar) on screen.

describe("NotFoundPage", () => {
	it("shows a page-not-found heading", () => {
		renderWithRouter(<NotFoundPage />);

		expect(
			screen.getByRole("heading", { name: "Page not found", level: 1 }),
		).toBeVisible();
	});

	it("links back to the dashboard", () => {
		renderWithRouter(<NotFoundPage />);

		expect(
			screen.getByRole("link", { name: "Back to Dashboard" }),
		).toHaveAttribute("href", "/");
	});
});

describe("RouteError", () => {
	it("shows a generic failure message with the underlying error", () => {
		renderWithRouter(<RouteError error={new Error("Failed to fetch")} />);

		expect(
			screen.getByRole("heading", { name: "Something went wrong", level: 1 }),
		).toBeVisible();
		expect(screen.getByText(/Failed to fetch/)).toBeVisible();
	});
});
