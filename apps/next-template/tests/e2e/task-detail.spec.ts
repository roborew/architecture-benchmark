import { test, expect } from "@playwright/test";
import { E2E_FIXTURE } from "./expectations";

test.describe("task detail", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(E2E_FIXTURE.task.href);
  });

  test("shows the task heading and project", async ({ page }) => {
    const main = page.getByRole("main");

    await expect(
      main.getByRole("heading", { name: E2E_FIXTURE.task.title, level: 1 }),
    ).toBeVisible();
    await expect(
      main.getByText(`Project: ${E2E_FIXTURE.task.projectName}`),
    ).toBeVisible();
  });

  test("shows the description and details sidebar", async ({ page }) => {
    const main = page.getByRole("main");
    const details = main.getByRole("region", { name: "Task details" });

    await expect(main.getByText(E2E_FIXTURE.task.description)).toBeVisible();
    await expect(details.getByText("Status")).toBeVisible();
    await expect(details.getByText("Assigned to")).toBeVisible();
  });

  test("lists the comments on the task", async ({ page }) => {
    const main = page.getByRole("main");

    await expect(
      main.getByRole("heading", { name: /Comments \(2\)/ }),
    ).toBeVisible();
    await expect(main.getByRole("article")).toHaveCount(2);
  });

  test("renders the add-comment form as static chrome", async ({ page }) => {
    const main = page.getByRole("main");

    await expect(main.getByLabel("Add comment")).toBeVisible();
    await expect(
      main.getByRole("button", { name: "Add comment", exact: true }),
    ).toBeVisible();
  });

  test("shows a not-found state for an unknown id", async ({ page }) => {
    await page.goto("/tasks/9999");

    await expect(
      page.getByRole("heading", { name: "Task not found" }),
    ).toBeVisible();
  });
});
