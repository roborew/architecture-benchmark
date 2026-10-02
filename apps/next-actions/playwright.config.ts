import { defineConfig, devices } from "@playwright/test";

import { E2E_PORT, e2eConnectionString } from "./tests/e2e/database";

// The suite always runs against its own database, never the developer's. The
// connection string is derived from POSTGRES_URL with only the database name
// swapped, and is handed to both the dev server and the setup hooks so they
// cannot disagree about which database is under test.
const E2E_DATABASE_URL = e2eConnectionString();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  // Only the browser suite lives here. Pointing testDir at ./tests would drag
  // the Vitest suites under tests/integration into Playwright's default
  // testMatch (**/*.@(spec|test).?(c|m)[jt]s?(x)) and fail on
  // `import { describe } from "vitest"`.
  testDir: "./tests/e2e",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Create, migrate and seed the isolated database before the suite. */
  globalSetup: "./tests/e2e/global-setup.ts",
  /* Drop it afterwards. */
  globalTeardown: "./tests/e2e/global-teardown.ts",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: `http://localhost:${E2E_PORT}`,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },

    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `pnpm dev --port ${E2E_PORT}`,
    // Wait on /healthz rather than the site root. Playwright starts the web
    // server *before* globalSetup creates and seeds the database, so probing a
    // page that reads the database would time out on a clean machine — the
    // server cannot serve it until the database exists. /healthz does not
    // touch the database, and spec/contract.md names it as the readiness
    // endpoint for exactly this purpose.
    url: `http://localhost:${E2E_PORT}/healthz`,
    // Never reuse an already-running dev server: it would be serving the
    // developer's database rather than the isolated e2e one.
    reuseExistingServer: false,
    env: {
      POSTGRES_URL: E2E_DATABASE_URL,
      // Separate build directory so this server does not contend with a
      // developer's `pnpm dev` over the Next.js lock on .next.
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
