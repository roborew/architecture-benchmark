import { test, expect } from "@playwright/test";

test("projects list renders seeded projects", async ({ page }) => {
  await page.goto("/");


  
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await expect(
    page.getByRole("cell", { name: "Website redesign" }),
  ).toBeVisible();
  await expect(page.getByText("3 projects")).toBeVisible();
});