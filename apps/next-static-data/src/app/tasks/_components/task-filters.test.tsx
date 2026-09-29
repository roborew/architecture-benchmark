import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskFilters } from "./task-filters";
import { projects, people } from "@/lib/seed-data";

describe("TaskFilters", () => {
  it("renders a labelled search field", () => {
    render(<TaskFilters projects={projects} people={people} />);

    expect(
      screen.getByRole("searchbox", { name: "Search tasks" }),
    ).toBeInTheDocument();
  });

  it("offers a project filter seeded with the projects", () => {
    render(<TaskFilters projects={projects} people={people} />);

    const select = screen.getByRole("combobox", { name: "Project" });

    expect(select).toHaveDisplayValue("All projects");
    expect(
      screen.getByRole("option", { name: "Website redesign" }),
    ).toBeInTheDocument();
  });

  it("offers every task status", () => {
    render(<TaskFilters projects={projects} people={people} />);

    const select = screen.getByRole("combobox", { name: "Status" });

    expect(select).toHaveDisplayValue("All statuses");
    expect(screen.getByRole("option", { name: "To do" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "In progress" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Done" })).toBeInTheDocument();
  });

  it("offers an assignee filter seeded with the people", () => {
    render(<TaskFilters projects={projects} people={people} />);

    const select = screen.getByRole("combobox", { name: "Assignee" });

    expect(select).toHaveDisplayValue("All assignees");
    expect(
      screen.getByRole("option", { name: "Robin Andrew" }),
    ).toBeInTheDocument();
  });

  it("has exactly three filter selects", () => {
    render(<TaskFilters projects={projects} people={people} />);

    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });
});
