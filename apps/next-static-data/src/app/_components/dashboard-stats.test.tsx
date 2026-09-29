import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardStats } from "./dashboard-stats";
import { dashboardStats } from "@/lib/seed-data";

describe("DashboardStats", () => {
  it("shows a card per workspace metric", () => {
    render(<DashboardStats stats={dashboardStats} />);

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Total tasks")).toBeInTheDocument();
    expect(screen.getByText("Open tasks")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
  });

  it("renders the seeded counts", () => {
    render(<DashboardStats stats={dashboardStats} />);

    expect(screen.getByText("Workspace projects")).toBeInTheDocument();
    expect(screen.getByText("Across all projects")).toBeInTheDocument();
    expect(screen.getByText("To do and in progress")).toBeInTheDocument();
    expect(screen.getByText("Workspace members")).toBeInTheDocument();
  });
});
