// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const ALIASES = {
  "@": path.resolve(__dirname, "./src"),
  "@tests": path.resolve(__dirname, "./tests"),
};

// Two projects, split by what they need:
//
//   unit        jsdom, no database. Renders components with the rows generated
//               from tests/fixtures/correctness/*.csv (src/test/data.ts).
//   integration node, real database. Exercises the query layer in src/lib
//               against the same fixture, so data-access regressions surface
//               here rather than only in the browser.
//
// Integration tests run against the isolated e2e database, which
// tests/integration/database.ts creates and seeds for each run.
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["**/*.integration.test.ts"],
          alias: ALIASES,
        },
      },
      {
        plugins: [react()],
        test: {
          name: "integration",
          environment: "node",
          globals: true,
          // Loads the isolated database before any test module imports the
          // query layer, which reads POSTGRES_URL at import time.
          setupFiles: ["./tests/integration/database.ts", "./vitest.setup.ts"],
          include: ["src/**/*.integration.test.ts"],
          // The database is per-process state; parallel workers would contend
          // for the same rows.
          fileParallelism: false,
          testTimeout: 15000,
          alias: ALIASES,
        },
      },
    ],
  },
});
