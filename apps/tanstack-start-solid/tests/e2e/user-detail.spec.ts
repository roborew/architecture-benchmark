import { expect, goto, test } from "./fixtures";
import { E2E_FIXTURE } from "./expectations";

test.describe("user detail", () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, E2E_FIXTURE.person.href);
  });

  test("shows the person heading and page title", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: E2E_FIXTURE.person.name, level: 1 }),
    ).toBeVisible();
  });

  test("shows the email and summary counts", async ({ page }) => {
    const main = page.getByRole("main");

    await expect(main.getByText(E2E_FIXTURE.person.email)).toBeVisible();
    // "Assigned tasks" is both a stat card label and a table heading.
    await expect(
      main.getByRole("heading", { name: "Assigned tasks" }),
    ).toBeVisible();
    await expect(
      main.getByText("Comments authored", { exact: true }),
    ).toBeVisible();
  });

  test("lists the tasks assigned to the person", async ({ page }) => {
    const main = page.getByRole("main");

    for (const title of E2E_FIXTURE.person.assignedTaskTitles) {
      await expect(main.getByRole("link", { name: title })).toBeVisible();
    }
  });

  test("links back to the people list", async ({ page }) => {
    await page.getByRole("main").getByRole("link", { name: "People" }).click();

    await expect(page).toHaveURL("/users");
  });

  test("shows a not-found state for an unknown id", async ({ page }) => {
    await goto(page, "/users/9999");

    await expect(
      page.getByRole("heading", { name: "Person not found" }),
    ).toBeVisible();
  });
});
