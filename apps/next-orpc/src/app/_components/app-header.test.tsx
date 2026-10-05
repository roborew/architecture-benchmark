import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppHeader } from "./app-header";

describe("AppHeader", () => {
  it("shows the workspace breadcrumb", () => {
    render(<AppHeader title="Dashboard" />);

    expect(screen.getByText("Demo workspace")).toBeInTheDocument();
  });

  it("renders the current page title", () => {
    render(<AppHeader title="Projects" />);

    // The testid is the shared contract across every benchmark app.
    expect(screen.getByTestId("page-title")).toHaveTextContent("Projects");
  });

  it("updates the title when the page changes", () => {
    const { rerender } = render(<AppHeader title="All tasks" />);

    expect(screen.getByTestId("page-title")).toHaveTextContent("All tasks");

    rerender(<AppHeader title="People" />);

    expect(screen.getByTestId("page-title")).toHaveTextContent("People");
  });

  it("shows the signed-in member", () => {
    render(<AppHeader title="Dashboard" />);

    expect(screen.getByText("RA")).toBeInTheDocument();
  });
});
