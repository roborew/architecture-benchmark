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
