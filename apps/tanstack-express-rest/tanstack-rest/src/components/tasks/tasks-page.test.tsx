import { makeTaskWithProject } from "@tests/fixtures/builders";
import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { TasksPage } from "./tasks-page";

// The page's presentational composition, with the rows handed in: heading,
// count, search field, table. The data-fetching wiring lives in the route and
// is covered end-to-end.

describe("TasksPage", () => {
  it("shows the All tasks heading and page copy", () => {
    renderWithRouter(<TasksPage tasks={[]} />);

    expect(
      screen.getByRole("heading", { name: "All tasks", level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByText("A workspace-wide view of tasks across every project."),
    ).toBeVisible();
  });

  it("shows the task count beside the table", () => {
    renderWithRouter(
      <TasksPage
        tasks={[
          makeTaskWithProject({ id: 1 }),
          makeTaskWithProject({ id: 2 }),
          makeTaskWithProject({ id: 3 }),
        ]}
      />,
    );

    expect(screen.getByText("3 tasks", { exact: true })).toBeVisible();
  });

  it("shows a search field labelled for its purpose", () => {
    renderWithRouter(<TasksPage tasks={[makeTaskWithProject()]} />);

    expect(
      screen.getByRole("searchbox", { name: "Search tasks" }),
    ).toBeVisible();
  });

  it("lists the tasks it is given", () => {
    const task = makeTaskWithProject({ title: "Listed Task" });

    renderWithRouter(<TasksPage tasks={[task]} />);

    expect(screen.getByText(task.title)).toBeVisible();
  });

  it("shows the empty state when there are no tasks", () => {
    renderWithRouter(<TasksPage tasks={[]} />);

    expect(screen.getByText("No tasks match these filters.")).toBeVisible();
  });
});
