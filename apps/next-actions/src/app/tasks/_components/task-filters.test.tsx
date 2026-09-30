import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskFilters } from "./task-filters";
import { fixtureProjects, fixturePeople } from "@tests/fixtures/builders";

describe("TaskFilters", () => {
  it("renders a labelled search field", () => {
    render(<TaskFilters projects={fixtureProjects} people={fixturePeople} />);

    expect(
      screen.getByRole("searchbox", { name: "Search tasks" }),
    ).toBeInTheDocument();
  });

  it("offers a project filter seeded with the projects", () => {
    render(<TaskFilters projects={fixtureProjects} people={fixturePeople} />);

    expect(
      screen.getByRole("combobox", { name: "Project" }),
    ).toHaveDisplayValue("All projects");

    fixtureProjects.forEach((project) => {
      expect(
        screen.getByRole("option", { name: project.name }),
      ).toBeInTheDocument();
    });
  });

  it("offers every task status", () => {
    render(<TaskFilters projects={fixtureProjects} people={fixturePeople} />);

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveDisplayValue(
      "All statuses",
    );

    ["To do", "In progress", "Done"].forEach((status) => {
      expect(screen.getByRole("option", { name: status })).toBeInTheDocument();
    });
  });

  it("offers an assignee filter seeded with the people", () => {
    render(<TaskFilters projects={fixtureProjects} people={fixturePeople} />);

    expect(
      screen.getByRole("combobox", { name: "Assignee" }),
    ).toHaveDisplayValue("All assignees");

    fixturePeople.forEach((person) => {
      expect(
        screen.getByRole("option", { name: person.name }),
      ).toBeInTheDocument();
    });
  });

  it("has exactly three filter selects", () => {
    render(<TaskFilters projects={fixtureProjects} people={fixturePeople} />);

    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });
});
