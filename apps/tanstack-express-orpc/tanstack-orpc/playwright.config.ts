import { defineConfig, devices } from "@playwright/test";

import {
	E2E_API_PORT,
	E2E_WEB_PORT,
	e2eConnectionString,
} from "./tests/e2e/database";

// The suite always runs against its own database, never the developer's. The
// connection string is derived from express-orpc's POSTGRES_URL with only the
// database name swapped, and is handed to the Express server so it cannot
// disagree about which database is under test.
const E2E_DATABASE_URL = e2eConnectionString();

export default defineConfig({
	// Only the browser suite lives here. Pointing testDir at ./tests would drag
	// the Vitest unit suites under tests/ into Playwright's default testMatch
	// and fail on `import { describe } from "vitest"`.
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "html",
	/* Create, migrate and seed the isolated database before the suite. */
	globalSetup: "./tests/e2e/global-setup.ts",
	/* Drop it afterwards. */
	globalTeardown: "./tests/e2e/global-teardown.ts",
	use: {
		baseURL: `http://localhost:${E2E_WEB_PORT}`,
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	// Two servers, started before the tests: the Express API the browser
	// fetches from, and the Vite dev server that serves the app. Playwright
	// starts web servers *before* globalSetup creates the database, so the
	// Express wait URL is /healthz, which deliberately never touches the
	// database.
	webServer: [
		{
			command: "pnpm start",
			cwd: "../express-orpc",
			url: `http://localhost:${E2E_API_PORT}/healthz`,
			// Never reuse an already-running dev server: it would be serving the
			// developer's database rather than the isolated e2e one.
			reuseExistingServer: false,
			env: {
				PORT: String(E2E_API_PORT),
				POSTGRES_URL: E2E_DATABASE_URL,
			},
		},
		{
			// `pnpm exec` rather than `pnpm dev --`: pnpm forwards a literal `--`
			// to the script (unlike npm), so the extra flag would be dropped.
			command: `pnpm exec vite dev --port ${E2E_WEB_PORT}`,
			url: `http://localhost:${E2E_WEB_PORT}`,
			reuseExistingServer: false,
			env: {
				// Where the browser-side fetch client points; the API server above.
				VITE_API_URL: `http://localhost:${E2E_API_PORT}`,
			},
		},
	],
});
