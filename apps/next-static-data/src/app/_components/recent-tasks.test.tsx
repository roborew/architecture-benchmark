import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RecentTasks } from "./recent-tasks";
import { dashboardRecentTasks } from "@/lib/seed-data";

describe("RecentTasks", () => {
  it("renders a row per task", () => {
    render(<RecentTasks tasks={dashboardRecentTasks} />);

    expect(screen.getAllByRole("row")).toHaveLength(
      dashboardRecentTasks.length + 1, // + header row
    );
  });

  it("links each task by title and shows its project", () => {
    render(<RecentTasks tasks={dashboardRecentTasks} />);

    const row = screen.getByRole("row", { name: /Draft navigation model/ });

    expect(
      within(row).getByRole("link", { name: "Draft navigation model" }),
    ).toHaveAttribute("href", "/tasks/101");
    expect(within(row).getByText("Website redesign")).toBeInTheDocument();
  });

  it("humanises the status", () => {
    render(<RecentTasks tasks={dashboardRecentTasks} />);

    const row = screen.getByRole("row", { name: /Draft navigation model/ });

    expect(within(row).getByText("In progress")).toBeInTheDocument();
    expect(within(row).getByText("To do")).toBeInTheDocument();
  });

  it("shows assignee and updated columns", () => {
    render(<RecentTasks tasks={dashboardRecentTasks} />);

    const row = screen.getByRole("row", { name: /Draft navigation model/ });

    expect(within(row).getByText("Robin Andrew")).toBeInTheDocument();
    expect(within(row).getByText("Today")).toBeInTheDocument();
  });

  it("shows an empty state when there are no recent tasks", () => {
    render(<RecentTasks tasks={[]} />);

    expect(screen.getByText("No recent task activity.")).toBeInTheDocument();
  });
});
