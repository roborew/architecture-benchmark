// vitest.config.ts
import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";
import path from "path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const ALIASES = {
  "@": path.resolve(root, "./src"),
  "@tests": path.resolve(root, "./tests"),
};

// Two projects, split by what they need:
//
//   unit        jsdom, no database. Renders components with the rows generated
//               from spec/snapshots/correctness/*.csv (tests/fixtures/data.ts).
//   integration node, real database. Exercises the query layer in src/server
//               against the same fixture, so data-access regressions surface
//               here rather than only in the browser.
//
// Integration tests run against the isolated e2e database, which
// tests/integration/database.ts creates and seeds for each run.
export default defineConfig({
  // Declared once here rather than per project: Vitest 5 has each inline
  // project inherit the declaring config, so repeating it applies the Solid
  // plugin twice and warns.
  plugins: [solidPlugin()],
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
          exclude: ["**/*.integration.test.ts"],
          alias: ALIASES,
          // Solid packages ship .jsx source files that vitest must transform.
          server: {
            deps: {
              inline: [
                /solid-js/,
                /@tanstack\/solid-/,
                /solid-testing-library/,
              ],
            },
          },
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          globals: true,
          // Loads the isolated database before any test module imports the
          // query layer, which reads POSTGRES_URL at import time.
          setupFiles: ["./tests/integration/database.ts", "./vitest.setup.ts"],
          include: ["tests/integration/**/*.integration.test.ts"],
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
