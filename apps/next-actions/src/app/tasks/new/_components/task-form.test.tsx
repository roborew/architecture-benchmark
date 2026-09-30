import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskForm } from "./task-form";
import { fixtureProjects, fixturePeople } from "@/test/fixtures";

describe("TaskForm", () => {
  it("renders labelled title and description fields", () => {
    render(<TaskForm projects={fixtureProjects} people={fixturePeople} />);

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("offers project, assignee and status selects", () => {
    render(<TaskForm projects={fixtureProjects} people={fixturePeople} />);

    expect(screen.getByRole("combobox", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assigned user" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
  });

  it("seeds the selects from the passed projects and people", () => {
    render(<TaskForm projects={fixtureProjects} people={fixturePeople} />);

    fixtureProjects.forEach((project) => {
      expect(
        screen.getByRole("option", { name: project.name }),
      ).toBeInTheDocument();
    });
    fixturePeople.forEach((person) => {
      expect(
        screen.getByRole("option", { name: person.name }),
      ).toBeInTheDocument();
    });
  });

  it("renders a cancel link and a create button", () => {
    render(<TaskForm projects={fixtureProjects} people={fixturePeople} />);

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/tasks",
    );
    expect(screen.getByRole("button", { name: "Create task" })).toBeInTheDocument();
  });

  it("does not submit anywhere, since this version implements no writes", () => {
    const { container } = render(
      <TaskForm projects={fixtureProjects} people={fixturePeople} />,
    );

    expect(container.querySelector("form")).toBeNull();
  });
});
