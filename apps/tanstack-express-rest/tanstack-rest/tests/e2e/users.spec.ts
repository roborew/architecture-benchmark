import { expect, test } from "@playwright/test";

import { E2E_FIXTURE, peopleCountLabel } from "./expectations";

// The users listing page, through a real browser against a real Express
// server and a real seeded database: the two apps wired together.

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
    page.getByText(peopleCountLabel(E2E_FIXTURE.counts.people), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search people" }),
  ).toBeVisible();
});

test("member rows link to their detail pages", async ({ page }) => {
  const link = page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(E2E_FIXTURE.person.name) });

  await expect(link).toHaveAttribute("href", E2E_FIXTURE.person.href);
});

test("narrows the list to matching members as the search settles", async ({
  page,
}) => {
  const search = page.getByRole("searchbox", { name: "Search people" });

  await search.fill("Robin");

  // The debounce replaces the URL, the loader prefetches the filtered query,
  // and the table re-renders — the URL settling first is the observable
  // half-way point, so wait for it before asserting on the rows.
  await expect(page).toHaveURL(/\/users\?q=Robin/);

  await expect(
    page.getByText(peopleCountLabel(1), { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: new RegExp(E2E_FIXTURE.person.name) }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: new RegExp(E2E_FIXTURE.people.alex) }),
  ).toHaveCount(0);
});

test("clearing the search restores the full list", async ({ page }) => {
  const search = page.getByRole("searchbox", { name: "Search people" });

  await search.fill("Robin");
  await expect(page).toHaveURL(/\/users\?q=Robin/);

  await search.fill("");

  await expect(page).toHaveURL(/\/users$/);
  await expect(
    page.getByText(peopleCountLabel(E2E_FIXTURE.counts.people), {
      exact: true,
    }),
  ).toBeVisible();
});

test("keeps the page template when the API is unreachable", async ({
  page,
}) => {
  // Simulate the backend being down: every users request is aborted at the
  // network layer, which is exactly what the browser sees when the Express
  // server is not running. The loader's query fails, and the route must show
  // the error inside the template — header, sidebar, page title — rather
  // than tearing the route tree down to a blank screen.
  await page.route("**/api/users**", (route) => route.abort("failed"));

  await page.goto("/users");

  await expect(page.getByTestId("page-title")).toHaveText("People");
  await expect(
    page.getByRole("complementary", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(page.getByText("Could not load people.")).toBeVisible();
});

test("an unbuilt menu entry shows the not-found page, not a crash", async ({
  page,
}) => {
  // Menu entries for routes that do not exist yet are plain anchors, so
  // clicking one is a full page navigation to a URL the router cannot match
  // (e.g. /projects). The app must boot into the not-found page inside the
  // template — not an unhandled error boundary or a blank screen.
  await page.goto("/users");

  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Projects" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Page not found", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("page-title")).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Main navigation" }),
  ).toBeVisible();

  // And the way back home still works from the not-found page.
  await page.getByRole("link", { name: "Back to Dashboard" }).click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Page not found", level: 1 }),
  ).toHaveCount(0);
});
