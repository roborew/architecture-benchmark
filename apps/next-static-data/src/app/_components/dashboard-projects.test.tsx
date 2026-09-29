import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DashboardProjects } from "./dashboard-projects";
import { dashboardProjects } from "@/lib/seed-data";

describe("DashboardProjects", () => {
  it("renders a card per project", () => {
    render(<DashboardProjects projects={dashboardProjects} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(dashboardProjects.length);
  });

  it("links each card to its project", () => {
    render(<DashboardProjects projects={dashboardProjects} />);

    expect(screen.getByRole("link", { name: /Website redesign/ })).toHaveAttribute(
      "href",
      "/projects/1",
    );
  });

  it("shows description and counts", () => {
    render(<DashboardProjects projects={dashboardProjects} />);

    const card = screen.getByRole("listitem", { name: /Website redesign/ });

    expect(
      within(card).getByText(
        "Refresh the public website and onboarding experience.",
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText("3")).toBeInTheDocument();
  });
});
