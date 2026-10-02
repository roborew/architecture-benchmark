// tests/integration/global-setup.ts
//
// Creates, migrates and seeds the isolated database once for the whole
// integration project, and drops it afterwards.
//
// This is a Vitest `globalSetup` rather than a `setupFiles` hook because it has
// to run exactly once. A `beforeAll` in `setupFiles` runs per test *file*, which
// meant ten CREATE/DROP cycles per run — and dropping in each file's teardown
// meant the drop raced the Drizzle pool that file still had open.
//
// The developer's database is never touched: `assertNotDevDatabase` refuses to
// start otherwise.

import { E2E_DATABASE, dropDatabase, e2eConnectionString, resetDatabase, seedDatabase } from "../e2e/database";
import { assertNotDevDatabase } from "../e2e/database";

export async function setup() {
  const connectionString = e2eConnectionString();

  // Fail loudly rather than risk a suite pointed at real dev data.
  assertNotDevDatabase(connectionString);

  console.log(`[integration] resetting ${E2E_DATABASE}`);

  await resetDatabase();
  await seedDatabase();

  console.log(`[integration] seeded ${E2E_DATABASE}`);
}

export async function teardown() {
  // This is the piece that was missing: nothing dropped the database when only
  // the integration tier ran, which left `..._e2e` on the server after every
  // `pnpm test:integration`.
  await dropDatabase();
}
