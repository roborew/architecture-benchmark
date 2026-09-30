import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("shows the label, value and hint", () => {
    render(<StatCard label="Projects" value={3} hint="Workspace projects" />);

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Workspace projects")).toBeInTheDocument();
  });

  it("renders the value as text", () => {
    render(<StatCard label="Open tasks" value={5} hint="To do and in progress" />);

    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("keeps the label and value out of the accessible name", () => {
    render(<StatCard label="People" value={3} hint="Workspace members" />);

    // The value is decorative-ish chrome; queries should target the label.
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.queryByText("Workspace members")).toBeInTheDocument();
  });
});
