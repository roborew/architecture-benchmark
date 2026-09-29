import { test, expect, type Page } from "@playwright/test";

// The <aside aria-label="Main navigation"> wraps the nav, so every link
// lookup is scoped here. Without this, "Projects" also matches the
// dashboard's stat card and section heading, and strict mode fails.

function sidebar(page: Page) {
  return page.getByRole("complementary", { name: "Main navigation" });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("lands on the dashboard by default", async ({ page }) => {
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("sidebar lists every workspace section", async ({ page }) => {
  const nav = sidebar(page);

  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Projects" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "All tasks" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "People" })).toBeVisible();
});

test("clicking Projects shows the projects page", async ({ page }) => {
  await sidebar(page).getByRole("link", { name: "Projects" }).click();

  await expect(page).toHaveURL("/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});

test("clicking All tasks shows the tasks page", async ({ page }) => {
  await sidebar(page).getByRole("link", { name: "All tasks" }).click();

  await expect(page).toHaveURL("/tasks");
  await expect(page.getByRole("heading", { name: "All tasks" })).toBeVisible();
});

test("clicking People shows the users page", async ({ page }) => {
  await sidebar(page).getByRole("link", { name: "People" }).click();

  await expect(page).toHaveURL("/users");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
});

test("Dashboard link returns to the dashboard", async ({ page }) => {
  await sidebar(page).getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL("/projects");

  await sidebar(page).getByRole("link", { name: "Dashboard" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("the brand link goes to the dashboard", async ({ page }) => {
  await sidebar(page).getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL("/projects");

  await sidebar(page).getByRole("link", { name: "Workspace" }).click();

  await expect(page).toHaveURL("/");
});

test("header reflects the current page", async ({ page }) => {
  await expect(page.getByTestId("page-title")).toHaveText("Dashboard");

  await sidebar(page).getByRole("link", { name: "Projects" }).click();

  await expect(page.getByTestId("page-title")).toHaveText("Projects");
});

test("marks the current page in the sidebar", async ({ page }) => {
  await expect(
    sidebar(page).getByRole("link", { name: "Dashboard" }),
  ).toHaveAttribute("aria-current", "page");

  await sidebar(page).getByRole("link", { name: "Projects" }).click();

  await expect(
    sidebar(page).getByRole("link", { name: "Projects" }),
  ).toHaveAttribute("aria-current", "page");
});
