import { expect, goto, test, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Asserts that no route has axe violations.
//
// This previously only reported, while the app inherited three
// contrast failures from the style reference. Those are fixed, so the
// assertion is live and a regression will fail the build.

type Route = { name: string; path: string };

const ROUTES: Route[] = [
  { name: "dashboard", path: "/" },
  { name: "projects", path: "/projects" },
  { name: "project detail", path: "/projects/1" },
  { name: "new project", path: "/projects/new" },
  { name: "edit project", path: "/projects/1/edit" },
  { name: "all tasks", path: "/tasks" },
  { name: "task detail", path: "/tasks/101" },
  { name: "new task", path: "/tasks/new" },
  { name: "people", path: "/users" },
  { name: "user detail", path: "/users/1" },
  { name: "new user", path: "/users/new" },
];

async function violationsOn(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();

  // Fold each violation into a readable line so a failure says which
  // rule broke and on which page, rather than dumping the raw payload.
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
    sample: violation.nodes[0]?.target?.[0] ?? "",
  }));
}

test.describe("accessibility", () => {
  for (const route of ROUTES) {
    test(`${route.name} has no axe violations`, async ({ page }) => {
      await goto(page, route.path);

      const violations = await violationsOn(page);

      if (violations.length > 0) {
        console.log(
          `\n${route.name} (${route.path}):` +
            violations
              .map(
                (violation) =>
                  `\n  [${violation.impact}] ${violation.id}: ${violation.help}` +
                  `\n      ${violation.nodes} node(s), e.g. ${violation.sample}`,
              )
              .join(""),
        );
      }

      expect(violations).toEqual([]);
    });
  }
});
