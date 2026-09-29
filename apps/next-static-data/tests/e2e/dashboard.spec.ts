import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("shows the dashboard heading and summary", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("Dashboard");
});

test("shows the workspace stat cards", async ({ page }) => {
  await expect(page.getByText("Total tasks")).toBeVisible();
  await expect(page.getByText("Open tasks")).toBeVisible();
  await expect(page.getByText("People")).toBeVisible();
});

test("lists recent tasks with their project", async ({ page }) => {
  await expect(
    page.getByRole("link", { name: "Draft navigation model" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("row", { name: /Draft navigation model/ })
      .getByText("Website redesign"),
  ).toBeVisible();
});

test("shows quick actions and the work summary", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Quick actions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Work summary" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create a project" }),
  ).toBeVisible();
});

test("linking a project card opens the project", async ({ page }) => {
  await page
    .getByRole("link", { name: /Website redesign/ })
    .first()
    .click();

  await expect(page).toHaveURL("/projects/1");
});
