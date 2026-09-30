import { test, expect } from "@playwright/test";
import { E2E_FIXTURE, projectCountLabel } from "./expectations";

test("projects list renders seeded projects", async ({ page }) => {
  await page.goto("/projects");

  // This testid is carried over from the reference HTML so every
  // benchmark app can be scored against the same contract.
  // await expect(page.getByTestId("projects-list-ready")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Projects", level: 1 }),
  ).toBeVisible();

  const main = page.getByRole("main");
  // A cell, not a link: the projects list does not link to the detail
  // page yet. Stage 7 adds that and tightens this assertion.
  await expect(
    main.getByRole("cell", { name: new RegExp(E2E_FIXTURE.project.name) }),
  ).toBeVisible();
  // Not exact: Playwright text matching is case-insensitive by default
  // and the page currently renders the count as "3 Projects".
  await expect(
    page.getByText(projectCountLabel(E2E_FIXTURE.counts.projects)),
  ).toBeVisible();
});
