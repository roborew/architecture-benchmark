import { expect, test } from "@playwright/test";

import { E2E_FIXTURE, tasksCountLabel } from "./expectations";

// The tasks listing page, through a real browser against a real FastAPI
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
	await expect(
		page.getByText(tasksCountLabel(E2E_FIXTURE.counts.tasks), {
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

test("narrows the list to matching tasks as the search settles", async ({
	page,
}) => {
	const search = page.getByRole("searchbox", { name: "Search tasks" });

	await search.fill("Draft");

	// The debounce replaces the URL, the loader prefetches the filtered query,
	// and the table re-renders — the URL settling first is the observable
	// half-way point, so wait for it before asserting on the rows.
	await expect(page).toHaveURL(/\/tasks\?q=Draft/);

	await expect(
		page.getByText(tasksCountLabel(1), { exact: true }),
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
	await expect(page).toHaveURL(/\/tasks\?q=Draft/);

	await search.fill("");

	await expect(page).toHaveURL(/\/tasks$/);
	await expect(
		page.getByText(tasksCountLabel(E2E_FIXTURE.counts.tasks), {
			exact: true,
		}),
	).toBeVisible();
});

test("keeps the page template when the API is unreachable", async ({
	page,
}) => {
	// Simulate the backend being down: every tasks request is aborted at the
	// network layer, which is exactly what the browser sees when the FastAPI
	// server is not running. The loader's query fails, and the route must show
	// the error inside the template — header, sidebar, page title — rather
	// than tearing the route tree down to a blank screen.
	await page.route("**/api/tasks**", (route) => route.abort("failed"));

	await page.goto("/tasks");

	await expect(page.getByTestId("page-title")).toHaveText("All tasks");
	await expect(
		page.getByRole("complementary", { name: "Main navigation" }),
	).toBeVisible();
	await expect(page.getByText("Could not load tasks.")).toBeVisible();
});

test("an unbuilt menu entry shows the not-found page, not a crash", async ({
	page,
}) => {
	// Menu entries for routes that do not exist yet are plain anchors, so
	// clicking one is a full page navigation to a URL the router cannot match
	// (e.g. /projects). The app must boot into the not-found page inside the
	// template — not an unhandled error boundary or a blank screen.
	await page.goto("/tasks");

	// The tasks route must have rendered before the navigation-under-test —
	// otherwise the not-found assertions below would pass vacuously on the
	// not-found page /tasks already shows before the route is built.
	await expect(
		page.getByRole("heading", { name: "All tasks", level: 1 }),
	).toBeVisible();

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
