import { test, expect } from "@playwright/test";
import { E2E_FIXTURE } from "./expectations";

test.describe("create pages", () => {
  test("project form shows its fields", async ({ page }) => {
    await page.goto("/projects/new");

    await expect(
      page.getByRole("heading", { name: "New project", level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel("Project name")).toBeVisible();
    await expect(page.getByLabel("Description")).toBeVisible();
    await expect(page.getByTestId("page-title")).toHaveText("New project");
  });

  test("project form cancels back to the projects list", async ({ page }) => {
    await page.goto("/projects/new");
    await page.getByRole("link", { name: "Cancel" }).click();

    await expect(page).toHaveURL("/projects");
  });

  test("user form shows its fields", async ({ page }) => {
    await page.goto("/users/new");

    await expect(
      page.getByRole("heading", { name: "New user", level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByTestId("page-title")).toHaveText("New user");
  });

  test("user form cancels back to the people list", async ({ page }) => {
    await page.goto("/users/new");
    await page.getByRole("link", { name: "Cancel" }).click();

    await expect(page).toHaveURL("/users");
  });

  test("task form shows its fields and selects", async ({ page }) => {
    await page.goto("/tasks/new");

    await expect(
      page.getByRole("heading", { name: "New task", level: 1 }),
    ).toBeVisible();

    // spec/contract.md requires two forms on this screen — the create-task form
    // and the atomic create-with-comment form — and the second repeats the
    // first's fields. The contract's `data-testid`s are what disambiguate them,
    // so every query here is scoped to the primary form.
    const form = page.getByTestId("create-task-form");

    await expect(form.getByLabel("Title")).toBeVisible();
    await expect(form.getByRole("combobox", { name: "Project" })).toBeVisible();
    await expect(
      form.getByRole("combobox", { name: "Assigned user" }),
    ).toBeVisible();
    await expect(form.getByRole("combobox", { name: "Status" })).toBeVisible();
    await expect(page.getByTestId("page-title")).toHaveText("New task");
  });

  test("task form offers the atomic create-with-comment form", async ({
    page,
  }) => {
    await page.goto("/tasks/new");

    // The contract requires this second form to exist and to carry the comment
    // fields alongside the task ones.
    const form = page.getByTestId("create-with-comment-form");

    await expect(form.getByLabel("First comment")).toBeVisible();
    await expect(
      form.getByRole("combobox", { name: "Comment author" }),
    ).toBeVisible();
    await expect(
      form.getByRole("button", { name: "Create with comment" }),
    ).toBeVisible();
  });

  test("task form cancels back to the tasks list", async ({ page }) => {
    await page.goto("/tasks/new");
    await page
      .getByTestId("create-task-form")
      .getByRole("link", { name: "Cancel" })
      .click();

    await expect(page).toHaveURL("/tasks");
  });
});

// The create path now writes. These assert the committed result is visible,
// which spec/contract.md requires — a 200 alone is not a completed mutation.
test.describe("project mutations", () => {
  // Runs last within its file so the rows it adds cannot shift the selectors
  // the read-only specs above rely on.
  test("creates a project and shows it in the list", async ({ page }) => {
    await page.goto("/projects/new");

    await page.getByLabel("Project name").fill("E2E created project");
    await page.getByLabel("Description").fill("Created by the e2e suite.");
    await page.getByRole("button", { name: "Create project" }).click();

    // Redirected to the list, where the new row is visible. `exact` matters:
    // each row also has an `aria-label="Edit <name>"` link, and a non-exact
    // match resolves to both and fails strict mode.
    await expect(page).toHaveURL("/projects");
    await expect(
      page.getByRole("main").getByRole("link", {
        name: "E2E created project",
        exact: true,
      }),
    ).toBeVisible();

    // Reload persistence: the row is read from the database, not the
    // client router cache.
    await page.reload();
    await expect(
      page.getByRole("main").getByRole("link", {
        name: "E2E created project",
        exact: true,
      }),
    ).toBeVisible();

    // Clean up through the UI. Playwright runs files in parallel against one
    // shared database, so a row left behind here would change the project count
    // the read-only specs assert.
    await page
      .getByRole("button", { name: "Delete E2E created project" })
      .click();
    await expect(
      page.getByRole("link", { name: "E2E created project", exact: true }),
    ).toHaveCount(0);
  });

  test("refuses to create a project without a name", async ({ page }) => {
    await page.goto("/projects/new");

    // `required` blocks submission in the browser; the server re-checks.
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(page).toHaveURL("/projects/new");
  });

  test("edits a project and shows the new values", async ({ page }) => {
    await page.goto("/projects/new");
    await page.getByLabel("Project name").fill("E2E edited project");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL("/projects");

    const row = page.getByRole("row").filter({ hasText: "E2E edited project" });
    await row.getByRole("link", { name: "Edit E2E edited project" }).click();

    await expect(
      page.getByRole("heading", { name: "Edit project", level: 1 }),
    ).toBeVisible();

    // The edit form is prefilled from the stored row.
    await expect(page.getByLabel("Project name")).toHaveValue(
      "E2E edited project",
    );

    await page.getByLabel("Project name").fill("E2E renamed project");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL("/projects");
    await expect(
      page.getByRole("main").getByRole("link", {
        name: "E2E renamed project",
        exact: true,
      }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("main").getByRole("link", {
        name: "E2E renamed project",
        exact: true,
      }),
    ).toBeVisible();

    // Clean up: see the note in "creates a project" — a leftover row changes the
    // count the read-only specs assert.
    await page
      .getByRole("button", { name: "Delete E2E renamed project" })
      .click();
    await expect(
      page.getByRole("link", { name: "E2E renamed project", exact: true }),
    ).toHaveCount(0);
  });

  test("deletes a project with no tasks", async ({ page }) => {
    await page.goto("/projects/new");
    await page.getByLabel("Project name").fill("E2E deleted project");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL("/projects");

    const row = page
      .getByRole("row")
      .filter({ hasText: "E2E deleted project" });
    await row
      .getByRole("button", { name: "Delete E2E deleted project" })
      .click();

    // Absence is the committed outcome, not a 200. `exact` so the assertion
    // counts only the row's own link and not its `Edit <name>` sibling.
    await expect(
      page.getByRole("link", { name: "E2E deleted project", exact: true }),
    ).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByRole("link", { name: "E2E deleted project", exact: true }),
    ).toHaveCount(0);
  });

  test("reports why a project with tasks cannot be deleted", async ({
    page,
  }) => {
    // Seeded project 1 has three tasks, and `tasks.project_id` is
    // ON DELETE RESTRICT, so the delete must fail with a readable message.
    await page.goto("/projects");

    await page
      .getByRole("button", { name: `Delete ${E2E_FIXTURE.project.name}` })
      .click();

    // Next.js renders its own `role="alert"` route announcer in the document,
    // so the page-level query resolves to two elements. Scoped to `main`, which
    // holds the app's message.
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "still has",
    );
    // Still present: nothing was removed.
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: E2E_FIXTURE.project.name, exact: true }),
    ).toBeVisible();
  });
});
