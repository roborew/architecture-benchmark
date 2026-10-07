import { makeUser } from "@tests/fixtures/builders";
import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { TasksPage } from "./tasks-page";

// The page's presentational composition, with the rows handed in: heading,
// count, search field, table. The data-fetching wiring lives in the route and
// is covered end-to-end.

describe("TasksPage", () => {
  it("shows the People heading and page copy", () => {
    renderWithRouter(<TasksPage tasks={[]} />);

    expect(
      screen.getByRole("heading", { name: "People", level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Manage workspace members who are assigned tasks and author comments.",
      ),
    ).toBeVisible();
  });

  it("shows the member count beside the section heading", () => {
    renderWithRouter(
      <TasksPage
        tasks={[]}
      />,
    );

    expect(screen.getByText("3 people", { exact: true })).toBeVisible();
  });

  it("shows a search field labelled for its purpose", () => {
    renderWithRouter(<TasksPage people={[makeUser()]} />);

    expect(
      screen.getByRole("searchbox", { name: "Search people" }),
    ).toBeVisible();
  });

  it("lists the people it is given", () => {
    const person = makeUser({ name: "Listed Person" });

    renderWithRouter(<TasksPage people={[person]} />);

    expect(screen.getByText(person.name)).toBeVisible();
  });

  it("shows the empty state when there are no people", () => {
    renderWithRouter(<TasksPage people={[]} />);

    expect(screen.getByText("No people in this workspace.")).toBeVisible();
  });
});
