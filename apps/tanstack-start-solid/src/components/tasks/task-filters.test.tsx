import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter, screen } from "@tests/helpers/render";
import userEvent from "@testing-library/user-event";
import { TaskFilters } from "./task-filters";
import { fixtureProjects, fixturePeople } from "@tests/fixtures/builders";

const navigate = vi.fn();

vi.mock("@tanstack/solid-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/solid-router")>();

  return {
    ...actual,
    useRouter: () => ({ navigate }),
  };
});

beforeEach(() => {
  navigate.mockClear();
});

describe("TaskFilters", () => {
  it("renders a labelled search field", () => {
    renderWithRouter(() => (
      <TaskFilters projects={fixtureProjects} people={fixturePeople} />
    ));

    expect(
      screen.getByRole("searchbox", { name: "Search tasks" }),
    ).toBeInTheDocument();
  });

  it("offers a project filter seeded with the projects", () => {
    renderWithRouter(() => (
      <TaskFilters projects={fixtureProjects} people={fixturePeople} />
    ));

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
    renderWithRouter(() => (
      <TaskFilters projects={fixtureProjects} people={fixturePeople} />
    ));

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveDisplayValue(
      "All statuses",
    );

    ["To do", "In progress", "Done"].forEach((status) => {
      expect(screen.getByRole("option", { name: status })).toBeInTheDocument();
    });
  });

  it("offers an assignee filter seeded with the people", () => {
    renderWithRouter(() => (
      <TaskFilters projects={fixtureProjects} people={fixturePeople} />
    ));

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
    renderWithRouter(() => (
      <TaskFilters projects={fixtureProjects} people={fixturePeople} />
    ));

    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("submits as a GET form, so filtering needs no client state", () => {
    const { container } = renderWithRouter(() => (
      <TaskFilters projects={fixtureProjects} people={fixturePeople} />
    ));

    const form = container.querySelector("form");

    expect(form).not.toBeNull();
    expect(form).toHaveAttribute("method", "get");
  });

  describe("submitting", () => {
    it("pushes only the filter that changed", async () => {
      const user = userEvent.setup();
      renderWithRouter(() => (
        <TaskFilters projects={fixtureProjects} people={fixturePeople} />
      ));

      await user.selectOptions(
        screen.getByRole("combobox", { name: "Project" }),
        String(fixtureProjects[0].id),
      );

      expect(navigate).toHaveBeenCalledWith({
        to: "/tasks",
        search: { project: String(fixtureProjects[0].id) },
        resetScroll: false,
      });
    });

    it("clearing a filter returns to the bare list", async () => {
      const user = userEvent.setup();
      renderWithRouter(() => (
        <TaskFilters
          projects={fixtureProjects}
          people={fixturePeople}
          projectId={fixtureProjects[0].id}
        />
      ));

      await user.selectOptions(
        screen.getByRole("combobox", { name: "Project" }),
        "",
      );

      expect(navigate).toHaveBeenCalledWith({
        to: "/tasks",
        resetScroll: false,
      });
    });

    it("keeps the other filters when one changes", async () => {
      const user = userEvent.setup();
      renderWithRouter(() => (
        <TaskFilters
          projects={fixtureProjects}
          people={fixturePeople}
          search="navigation"
          status="todo"
        />
      ));

      await user.selectOptions(
        screen.getByRole("combobox", { name: "Assignee" }),
        String(fixturePeople[0].id),
      );

      expect(navigate).toHaveBeenCalledWith({
        to: "/tasks",
        search: {
          q: "navigation",
          status: "todo",
          assignee: String(fixturePeople[0].id),
        },
        resetScroll: false,
      });
    });

    it("submits the search term on Enter", async () => {
      const user = userEvent.setup();
      renderWithRouter(() => (
        <TaskFilters projects={fixtureProjects} people={fixturePeople} />
      ));

      await user.type(
        screen.getByRole("searchbox", { name: "Search tasks" }),
        "breakpoint{Enter}",
      );

      expect(navigate).toHaveBeenCalledWith({
        to: "/tasks",
        search: { q: "breakpoint" },
        resetScroll: false,
      });
    });
  });

  it("names every control, or the submission carries nothing", () => {
    const { container } = renderWithRouter(() => (
      <TaskFilters projects={fixtureProjects} people={fixturePeople} />
    ));

    for (const name of ["q", "project", "status", "assignee"]) {
      expect(
        container.querySelector(`[name="${name}"]`),
        `missing ${name}`,
      ).not.toBeNull();
    }
  });

  it("shows the filters that are currently applied", () => {
    renderWithRouter(() => (
      <TaskFilters
        projects={fixtureProjects}
        people={fixturePeople}
        status="in-progress"
        projectId={fixtureProjects[0].id}
        assigneeId={fixturePeople[0].id}
      />
    ));

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
    renderWithRouter(() => (
      <TaskFilters
        projects={fixtureProjects}
        people={fixturePeople}
        search="navigation"
      />
    ));

    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue(
      "navigation",
    );
  });
});
