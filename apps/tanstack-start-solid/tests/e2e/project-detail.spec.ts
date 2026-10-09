import { expect, goto, test } from "./fixtures";
import { E2E_FIXTURE } from "./expectations";

test.describe("project detail", () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, E2E_FIXTURE.project.href);
  });

  test("shows the project heading, description and breadcrumb", async ({
    page,
  }) => {
    const main = page.getByRole("main");

    await expect(
      main.getByRole("heading", { name: E2E_FIXTURE.project.name, level: 1 }),
    ).toBeVisible();
    await expect(main.getByRole("link", { name: "Projects" })).toBeVisible();
  });

  test("renders the three summary counts", async ({ page }) => {
    const main = page.getByRole("main");

    for (const label of ["Tasks", "Open", "People"]) {
      await expect(main.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("shows the project tasks table with a status filter", async ({
    page,
  }) => {
    const main = page.getByRole("main");

    await expect(
      main.getByRole("heading", { name: "Project tasks" }),
    ).toBeVisible();
    await expect(
      main.getByRole("searchbox", { name: "Search tasks" }),
    ).toBeVisible();
    // The status control is a set of tabs (spec/contract.md): one per status
    // plus `all`, each tagged with the raw stored spelling in `data-status`.
    await expect(main.getByTestId("status-filter").first()).toBeVisible();
    await expect(main.locator('[data-status="all"]')).toBeVisible();
    await expect(main.locator('[data-status="done"]')).toBeVisible();
  });

  test("links a task to its detail page", async ({ page }) => {
    await page
      .getByRole("main")
      .getByRole("link", { name: E2E_FIXTURE.task.title })
      .click();

    await expect(page).toHaveURL(E2E_FIXTURE.task.href);
  });

  test("shows a not-found state for an unknown id", async ({ page }) => {
    await goto(page, "/projects/9999");

    await expect(
      page.getByRole("heading", { name: "Project not found" }),
    ).toBeVisible();
  });
});
