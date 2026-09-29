import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { dashboardProjects } from "@/lib/seed-data";
import { DashboardProjects } from "./dashboard-projects";

describe("DashboardProjects", () => {
  it("renders a card per project", () => {
    render(<DashboardProjects projects={dashboardProjects} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(
      dashboardProjects.length,
    );
  });

  it("links each card to its project", () => {
    render(<DashboardProjects projects={dashboardProjects} />);

    expect(
      screen.getByRole("link", { name: /Website redesign/ }),
    ).toHaveAttribute("href", "/projects/1");
  });

  it("shows description and counts", () => {
    render(<DashboardProjects projects={dashboardProjects} />);

    // listitem is not a name-from-content role, so the card is scoped
    // through its link instead.
    const card = screen.getByRole("link", { name: /Website redesign/ });

    expect(card).toHaveAccessibleName(
      /Refresh the public website and onboarding experience\./,
    );

    // "3" is both the task count and the people count for this project,
    // so the badge and the footer figure are asserted together.
    expect(within(card).getAllByText("3")).toHaveLength(2);
    expect(within(card).getByText("2")).toBeInTheDocument();
  });
});
