import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { AppHeader } from "./app-header";

describe("AppHeader", () => {
	it("shows the workspace breadcrumb", () => {
		renderWithRouter(() => <AppHeader title="Dashboard" />);

		expect(screen.getByText("Demo workspace")).toBeInTheDocument();
	});

	it("renders the current page title", () => {
		renderWithRouter(() => <AppHeader title="Projects" />);

		expect(screen.getByTestId("page-title")).toHaveTextContent("Projects");
	});

	it("shows the signed-in member", () => {
		renderWithRouter(() => <AppHeader title="Dashboard" />);

		expect(screen.getByText("RA")).toBeInTheDocument();
	});
});
