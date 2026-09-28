import { test, expect } from "@playwright/test";

test("projects list renders seeded projects", async ({ page }) => {
  await page.goto("/projects");

  // This testid is carried over from the reference HTML so every
  // benchmark app can be scored against the same contract.
  await expect(page.getByTestId("projects-list-ready")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await expect(
    page.getByRole("cell", { name: "Website redesign" }),
  ).toBeVisible();
  await expect(page.getByText("3 projects")).toBeVisible();
});
