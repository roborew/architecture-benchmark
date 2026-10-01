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

  it("submits as a GET form, so filtering needs no client state", () => {
    const { container } = render(
      <TaskFilters projects={fixtureProjects} people={fixturePeople} />,
    );

    const form = container.querySelector("form");

    expect(form).not.toBeNull();
    expect(form).toHaveAttribute("method", "get");
  });

  it("names every control, or the submission carries nothing", () => {
    const { container } = render(
      <TaskFilters projects={fixtureProjects} people={fixturePeople} />,
    );

    for (const name of ["q", "project", "status", "assignee"]) {
      expect(
        container.querySelector(`[name="${name}"]`),
        `missing ${name}`,
      ).not.toBeNull();
    }
  });

  it("shows the filters that are currently applied", () => {
    render(
      <TaskFilters
        projects={fixtureProjects}
        people={fixturePeople}
        status="in-progress"
        projectId={fixtureProjects[0].id}
        assigneeId={fixturePeople[0].id}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue(
      "in-progress",
    );
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue(
      String(fixtureProjects[0].id),
    );
    expect(screen.getByRole("combobox", { name: "Assignee" })).toHaveValue(
      String(fixturePeople[0].id),
    );
  });

  it("shows the applied search term", () => {
    render(
      <TaskFilters
        projects={fixtureProjects}
        people={fixturePeople}
        search="navigation"
      />,
    );

    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue(
      "navigation",
    );
  });
});
