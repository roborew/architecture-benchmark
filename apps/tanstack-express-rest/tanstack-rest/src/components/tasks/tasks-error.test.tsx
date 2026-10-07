import { renderWithRouter, screen } from "@tests/helpers/render";
import { describe, expect, it } from "vitest";
import { TasksError } from "./tasks-error";

// The /users route's errorComponent: when the loader's query fails (the API
// unreachable, a 500), the error renders INSIDE the page template rather than
// tearing the whole route tree down.

describe("TasksError", () => {
  it("shows an inline message naming the page that failed", () => {
    renderWithRouter(<TasksError error={new Error("Failed to fetch")} />);

    expect(screen.getByText("Could not load people.")).toBeVisible();
  });

  it("shows the underlying error message", () => {
    renderWithRouter(<TasksError error={new Error("Failed to fetch")} />);

    expect(screen.getByText(/Failed to fetch/)).toBeVisible();
  });

  it("suggests the likely cause for a fetch failure", () => {
    renderWithRouter(<TasksError error={new Error("Failed to fetch")} />);

    expect(screen.getByText(/Is the API server running/)).toBeVisible();
  });

  it("renders inside the page container styling", () => {
    const { container } = renderWithRouter(
      <TasksError error={new Error("Failed to fetch")} />,
    );

    expect(container.firstChild).toHaveClass("mx-auto", "w-full", "max-w-310");
  });
});
