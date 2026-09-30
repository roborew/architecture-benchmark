import { test, expect } from "@playwright/test";
import { E2E_FIXTURE } from "./expectations";

test.beforeEach(async ({ page }) => {
  await page.goto("/tasks");
});

test("shows the all tasks heading and page title", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "All tasks", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("All tasks");
});

test("renders the filter controls", async ({ page }) => {
  await expect(
    page.getByRole("searchbox", { name: "Search tasks" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Project" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Assignee" })).toBeVisible();
});

test("lists seeded tasks with their project", async ({ page }) => {
  const main = page.getByRole("main");
  const { task } = E2E_FIXTURE;

  await expect(main.getByRole("link", { name: task.title })).toBeVisible();
  await expect(
    main
      .getByRole("row", { name: new RegExp(task.crossProjectTitle) })
      .getByText(task.crossProjectName),
  ).toBeVisible();
});

test("shows the result count and pagination", async ({ page }) => {
  // The figures are implementation details, so the shape is asserted
  // rather than the exact page size and total.
  await expect(page.getByText(E2E_FIXTURE.pagination.summary)).toBeVisible();

  // exact: the Next.js dev tools button also matches "Next" as a
  // substring when the suite runs against the dev server.
  await expect(
    page.getByRole("button", { name: "Previous", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeEnabled();
});

test("a task title links to the task detail", async ({ page }) => {
  await page
    .getByRole("main")
    .getByRole("link", { name: E2E_FIXTURE.task.title })
    .click();

  await expect(page).toHaveURL(E2E_FIXTURE.task.href);
});
