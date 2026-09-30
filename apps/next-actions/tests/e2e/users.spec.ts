import { test, expect } from "@playwright/test";
import { E2E_FIXTURE, peopleCountLabel } from "./expectations";

test.beforeEach(async ({ page }) => {
  await page.goto("/users");
});

test("shows the people heading and page title", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "People", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("People");
});

test("lists the seeded workspace members", async ({ page }) => {
  const main = page.getByRole("main");

  await expect(
    main.getByRole("row", { name: new RegExp(E2E_FIXTURE.person.name) }),
  ).toBeVisible();
  await expect(main.getByText(E2E_FIXTURE.person.email)).toBeVisible();
});

test("shows the member count and a search field", async ({ page }) => {
  await expect(
    page.getByText(peopleCountLabel(E2E_FIXTURE.counts.people), { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search people" })).toBeVisible();
});

test("a member links to their detail page", async ({ page }) => {
  await page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(E2E_FIXTURE.person.name) })
    .click();

  await expect(page).toHaveURL(E2E_FIXTURE.person.href);
});
