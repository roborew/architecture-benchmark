// vitest.config.ts
//
// Two projects, split by what they need:
//
//   unit        no database. Exercises controllers with the model layer
//               stubbed, plus pure helpers.
//   integration real database. Exercises the HTTP surface (routes →
//               controllers → models → Postgres) through supertest, so a
//               data-access regression surfaces here rather than in the
//               browser.
//
// Integration tests run against the isolated test database, which
// tests/integration/database.ts creates and seeds for each run.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          globals: true,
          include: ["tests/unit/**/*.test.ts"],
          // Empty until the first unit suite lands; keep the script runnable.
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          globals: true,
          // Loads the isolated database before any test module imports the
          // db layer, which reads POSTGRES_URL at import time.
          setupFiles: ["./tests/integration/database.ts"],
          include: ["tests/integration/**/*.integration.test.ts"],
          exclude: ["**/database.ts"],
          // The database is per-process state; parallel workers would contend
          // for the same rows.
          fileParallelism: false,
          testTimeout: 15000,
        },
      },
    ],
  },
});
