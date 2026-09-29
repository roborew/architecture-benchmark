import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProjectList } from "./project-list";
import { projects } from "@/lib/seed-data";

describe("ProjectList", () => {
  it("renders a row for each project", () => {
    render(<ProjectList projects={projects} />);

    const row = screen.getByRole("row", { name: /Website redesign/ });

    expect(
      within(row).getByRole("cell", { name: /Website redesign/ }),
    ).toBeInTheDocument();
    expect(within(row).getByRole("cell", { name: "3" })).toBeInTheDocument();
    expect(within(row).getByRole("cell", { name: "2" })).toBeInTheDocument();
  });

  it("shows an empty state when there are no projects", () => {
    render(<ProjectList projects={[]} />);

    expect(screen.getByText("No projects yet.")).toBeInTheDocument();
  });
});
