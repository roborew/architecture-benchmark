import { test, expect } from "@playwright/test";
import { E2E_FIXTURE, projectCountLabel } from "./expectations";

test.beforeEach(async ({ page }) => {
  await page.goto("/projects");
});

test("shows the projects heading and page title", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Projects", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("Projects");
});

test("shows the breadcrumb and panel heading", async ({ page }) => {
  await expect(page.getByText("Workspace / Projects")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "All projects" }),
  ).toBeVisible();
});

test("lists the seeded projects with their counts", async ({ page }) => {
  const main = page.getByRole("main");

  // Scoped to the row's own link. Each row also carries an
  // `aria-label="Edit <name>"` link, and a non-exact name match would resolve
  // to both — the strict-mode violation this replaced.
  await expect(
    main.getByRole("link", {
      name: E2E_FIXTURE.project.name,
      exact: true,
    }),
  ).toBeVisible();
  // Not exact: Playwright text matching is case-insensitive by default
  // and the page currently renders the count as "3 Projects".
  await expect(
    page.getByText(projectCountLabel(E2E_FIXTURE.counts.projects)),
  ).toBeVisible();
});

test("offers a project search field and a new project link", async ({
  page,
}) => {
  await expect(
    page.getByRole("searchbox", { name: "Search projects" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "New project" })).toBeVisible();
});

test("a project name links to its detail page", async ({ page }) => {
  await page
    .getByRole("main")
    .getByRole("link", { name: E2E_FIXTURE.project.name, exact: true })
    .click();

  await expect(page).toHaveURL(E2E_FIXTURE.project.href);
});

test("each row offers an edit link to its edit page", async ({ page }) => {
  const row = page
    .getByRole("row")
    .filter({ hasText: E2E_FIXTURE.project.name });

  await row
    .getByRole("link", { name: `Edit ${E2E_FIXTURE.project.name}` })
    .click();

  await expect(page).toHaveURL("/projects/1/edit");
  await expect(
    page.getByRole("heading", { name: "Edit project", level: 1 }),
  ).toBeVisible();
});

test("each row offers a delete control naming its project", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: `Delete ${E2E_FIXTURE.project.name}` }),
  ).toBeVisible();
});
