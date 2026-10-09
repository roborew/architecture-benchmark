import { expect, test } from "@playwright/test";

import { E2E_FIXTURE, tasksSummaryLabel } from "./expectations";

// The tasks listing page, through a real browser against a real Express
// server and a real seeded database: the two apps wired together.

test.beforeEach(async ({ page }) => {
	await page.goto("/tasks");
});

test("shows the all tasks heading and page title", async ({ page }) => {
	await expect(
		page.getByRole("heading", { name: "All tasks", level: 1 }),
	).toBeVisible();
	await expect(page.getByTestId("page-title")).toHaveText("All tasks");
});

test("lists the seeded tasks with their project", async ({ page }) => {
	const main = page.getByRole("main");
	const row = main.getByRole("row", {
		name: new RegExp(E2E_FIXTURE.task.title),
	});

	await expect(row).toBeVisible();
	// The project name is shared by several seeded tasks, so it is asserted
	// inside this task's own row rather than across the whole table.
	await expect(row.getByText(E2E_FIXTURE.task.projectName)).toBeVisible();
});

test("shows the task count and a search field", async ({ page }) => {
	// The count is the summary line under the table (lib/pagination.ts), not a
	// bare figure: the fixture's six tasks fit the default page size, so the
	// line spans the whole set.
	await expect(
		page.getByText(tasksSummaryLabel(E2E_FIXTURE.counts.tasks), {
			exact: true,
		}),
	).toBeVisible();
	await expect(
		page.getByRole("searchbox", { name: "Search tasks" }),
	).toBeVisible();
});

test("task rows link to their detail pages", async ({ page }) => {
	const link = page
		.getByRole("main")
		.getByRole("link", { name: new RegExp(E2E_FIXTURE.task.title) });

	await expect(link).toHaveAttribute("href", E2E_FIXTURE.task.href);
});

test("narrows the list to matching tasks when the search is submitted", async ({
	page,
}) => {
	const search = page.getByRole("searchbox", { name: "Search tasks" });

	// Unlike the users page's debounced search, the tasks filter bar is a form:
	// the query is only sent once the user submits it (Enter).
	await search.fill("Draft");
	await search.press("Enter");

	// The submit replaces the URL, the loader prefetches the filtered query, and
	// the table re-renders — the URL settling first is the observable half-way
	// point, so wait for it before asserting on the rows.
	await expect(page).toHaveURL(/\/tasks\?q=Draft/);

	await expect(
		page.getByText(tasksSummaryLabel(1, { filtered: true }), {
			exact: true,
		}),
	).toBeVisible();
	await expect(
		page.getByRole("row", { name: new RegExp(E2E_FIXTURE.task.title) }),
	).toBeVisible();
	await expect(
		page.getByRole("row", {
			name: new RegExp(E2E_FIXTURE.tasks.nextByUpdate),
		}),
	).toHaveCount(0);
});

test("clearing the search restores the full list", async ({ page }) => {
	const search = page.getByRole("searchbox", { name: "Search tasks" });

	await search.fill("Draft");
	await search.press("Enter");
	await expect(page).toHaveURL(/\/tasks\?q=Draft/);

	await search.fill("");
	await search.press("Enter");

	await expect(page).toHaveURL(/\/tasks$/);
	await expect(
		page.getByText(tasksSummaryLabel(E2E_FIXTURE.counts.tasks), {
			exact: true,
		}),
	).toBeVisible();
});

test("keeps the page template when the API is unreachable", async ({
	page,
}) => {
	// Simulate the backend being down: every RPC request is aborted at the
	// network layer, which is exactly what the browser sees when the Express
	// server is not running. The loader's query fails, and the route must show
	// the error inside the template — header, sidebar, page title — rather
	// than tearing the route tree down to a blank screen.
	await page.route("**/rpc/**", (route) => route.abort("failed"));

	await page.goto("/tasks");

	await expect(page.getByTestId("page-title")).toHaveText("All tasks");
	await expect(
		page.getByRole("complementary", { name: "Main navigation" }),
	).toBeVisible();
	await expect(page.getByText("Could not load tasks.")).toBeVisible();
});

test("an unknown URL shows the not-found page, not a crash", async ({
	page,
}) => {
	// A URL that matches no route — a typo, or a stale link — is a full page
	// load the router cannot resolve. The app must boot into the not-found page
	// inside the template — header, sidebar, page title — not an unhandled
	// error boundary or a blank screen.
	await page.goto("/does-not-exist");

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
