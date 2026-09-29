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
  // Scoped to main, and exact because "People" is also a substring of
  // the project card footers ("2 open 3 people").
  const main = page.getByRole("main");

  await expect(main.getByText("Total tasks", { exact: true })).toBeVisible();
  await expect(main.getByText("Open tasks", { exact: true })).toBeVisible();
  await expect(main.getByText("People", { exact: true })).toBeVisible();
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
  // Quick actions are Links in the Next app, not the reference's
  // data-page-target buttons, so they carry the link role.
  await expect(
    page.getByRole("link", { name: "Create a project" }),
  ).toBeVisible();
});

test("linking a project card opens the project", async ({ page }) => {
  await page
    .getByRole("link", { name: /Website redesign/ })
    .first()
    .click();

  await expect(page).toHaveURL("/projects/1");
});
