import { test, expect } from "@playwright/test";

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
    await expect(page.getByLabel("Title")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Project" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Assigned user" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();
    await expect(page.getByTestId("page-title")).toHaveText("New task");
  });

  test("task form cancels back to the tasks list", async ({ page }) => {
    await page.goto("/tasks/new");
    await page.getByRole("link", { name: "Cancel" }).click();

    await expect(page).toHaveURL("/tasks");
  });

  test("create buttons are inert, since this version implements no writes", async ({ page }) => {
    await page.goto("/projects/new");

    await page.getByRole("button", { name: "Create project" }).click();

    // Still on the form: nothing was created.
    await expect(page).toHaveURL("/projects/new");
  });
});
