import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

// The template every page renders inside: header, navigation sidebar, and a
// main landmark for the route's content. A route that fails must never take
// the template down with it, so the shell's presence is asserted on its own.

describe("AppShell", () => {
	it("renders a main landmark around the route content", () => {
		renderWithRouter(
			<AppShell>
				<p>Route content</p>
			</AppShell>,
		);

		const main = screen.getByRole("main");

		expect(main).toBeInTheDocument();
		expect(screen.getByText("Route content")).toBeInTheDocument();
	});

	it("renders the navigation sidebar", () => {
		renderWithRouter(<AppShell>{null}</AppShell>);

		expect(
			screen.getByRole("complementary", { name: "Main navigation" }),
		).toBeInTheDocument();
	});

	it("renders the header with the current page title", () => {
		renderWithRouter(
			<AppShell>
				<p>Route content</p>
			</AppShell>,
			{ route: "/users" },
		);

		expect(screen.getByTestId("page-title")).toHaveTextContent("People");
	});
});
