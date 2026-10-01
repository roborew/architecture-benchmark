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

  // All six seeded tasks fit the default page size, so there is nothing
  // older to reach until the size is dropped.
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();

  await page
    .getByRole("combobox", { name: "Tasks per page" })
    .selectOption("5");

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

test("the next page shows older tasks, without repeating the first", async ({
  page,
}) => {
  const main = page.getByRole("main");

  // Drop to five a page so the six seeded tasks span two pages. The URL wait
  // matters: without it the rows below are read before the navigation lands,
  // and page one looks like it holds all six.
  await page
    .getByRole("combobox", { name: "Tasks per page" })
    .selectOption("5");
  await expect(page).toHaveURL(/size=5/);

  // Scoped to table body rows: the header row repeats on every page, and
  // `getByRole("link")` across the whole main region would also catch the
  // "New task" link.
  const rowTitles = async () =>
    (
      await main.getByRole("rowgroup").nth(1).getByRole("row").allTextContents()
    ).map((row) => row.replace(/Edit.*$/, "").trim());

  const firstPageTitles = await rowTitles();

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);

  const secondPageTitles = await rowTitles();

  expect(firstPageTitles.length).toBeGreaterThan(0);
  expect(secondPageTitles.length).toBeGreaterThan(0);

  // Keyset paging fails by repeating a row or skipping one; either would show
  // up here as an overlap between the two pages.
  expect(
    secondPageTitles.filter((title) => firstPageTitles.includes(title)),
  ).toEqual([]);
});

test("the previous control returns to the first page", async ({ page }) => {
  await page
    .getByRole("combobox", { name: "Tasks per page" })
    .selectOption("5");

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(
    page.getByRole("button", { name: "Previous", exact: true }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Previous", exact: true }).click();

  await expect(page).not.toHaveURL(/cursor=/);
  await expect(
    page.getByRole("button", { name: "Previous", exact: true }),
  ).toBeDisabled();
});

test("the summary reports where in the list the reader is", async ({
  page,
}) => {
  // The bug: the start was hardcoded to 1 and the end was the page's row
  // count, so every page claimed to be the first.
  const summary = page.getByText(/Showing \d+-\d+ of \d+/);

  await expect(summary).toHaveText(`Showing 1-6 of 6 tasks`);

  // Drop to the smallest page size so the six seeded tasks span two pages.
  await page
    .getByRole("combobox", { name: "Tasks per page" })
    .selectOption("5");

  await expect(summary).toHaveText("Showing 1-5 of 6 tasks");

  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Page two holds the single remaining task, at position 6.
  await expect(summary).toHaveText("Showing 6-6 of 6 tasks");
});

test("offers 10 tasks a page", async ({ page }) => {
  const perPage = page.getByRole("combobox", { name: "Tasks per page" });

  await expect(perPage).toBeVisible();

  // The default is the whole six-row fixture, so every task is visible.
  await expect(
    page.getByRole("main").getByRole("link", { name: E2E_FIXTURE.task.title }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Write migration checklist" }),
  ).toBeVisible();

  await perPage.selectOption("5");

  await expect(page).toHaveURL(/size=5/);
  // Only the first five are now on screen.
  await expect(
    page.getByRole("link", { name: "Write migration checklist" }),
  ).toHaveCount(0);
});

test("changing the page size returns to the first page of the same filters", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Project" })
    .selectOption({ label: E2E_FIXTURE.project.secondName });
  // Wait for that navigation before touching the second control: changing a
  // filter re-renders the page, and the size select on a page mid-navigation
  // would build its link from stale filters and drop this one.
  await expect(page).toHaveURL(/project=2/);

  await page
    .getByRole("combobox", { name: "Tasks per page" })
    .selectOption("5");

  // The filter survives, and the cursor does not carry over.
  await expect(page).toHaveURL(/project=2/);
  await expect(page).toHaveURL(/size=5/);
  await expect(page).not.toHaveURL(/cursor=/);
});

test("filters the list by project", async ({ page }) => {
  await page.goto("/tasks");

  await page
    .getByRole("combobox", { name: "Project" })
    .selectOption({ label: E2E_FIXTURE.project.secondName });

  await expect(page).toHaveURL(/project=2/);
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: E2E_FIXTURE.task.crossProjectTitle }),
  ).toBeVisible();
  // Nothing from the other project may survive the filter.
  await expect(
    page.getByRole("link", { name: E2E_FIXTURE.task.title }),
  ).toHaveCount(0);
});

test("filters the list by status", async ({ page }) => {
  await page.goto("/tasks");

  await page.getByRole("combobox", { name: "Status" }).selectOption("done");

  await expect(page).toHaveURL(/status=done/);
  // "Prepare content inventory" is the only seeded done task.
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: "Prepare content inventory" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: E2E_FIXTURE.task.title }),
  ).toHaveCount(0);
});

test("searches tasks by title", async ({ page }) => {
  await page.goto("/tasks");

  await page
    .getByRole("searchbox", { name: "Search tasks" })
    .fill("breakpoint");
  await page.getByRole("searchbox", { name: "Search tasks" }).press("Enter");

  await expect(page).toHaveURL(/q=breakpoint/);
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: "Confirm breakpoint rules" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: E2E_FIXTURE.task.title }),
  ).toHaveCount(0);
});
