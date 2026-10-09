import { defineConfig } from "@playwright/test";

// Black-box correctness suite (plan R5, §6.3). It drives whatever app is at
// `BENCH_BASE_URL` — a single-service app, or the SPA half of a `spa-api` stack
// — using only the contract's routes and `data-testid`s (spec/contract.md). One
// worker, serial: a failure must be attributable, not racy.
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.BENCH_BASE_URL,
    viewport: { width: 1365, height: 768 },
    trace: "off",
  },
  reporter: [
    [
      "json",
      { outputFile: process.env.BENCH_REPORT ?? "playwright-report.json" },
    ],
  ],
});
