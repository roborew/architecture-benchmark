// tests/integration/database.ts
//
// Points the query layer at the isolated test database and guarantees it is
// seeded, so integration tests assert against the same rows the e2e suite
// will.
//
// `src/db/connection.ts` reads POSTGRES_URL at import time, so this must run
// before any test imports it — hence a Vitest `setupFiles` entry rather than a
// helper called from inside a test file.

import { beforeAll } from "vitest";

import {
  E2E_DATABASE,
  assertNotDevDatabase,
  e2eConnectionString,
  resetDatabase,
  seedDatabase,
} from "../helpers/database.ts";

const connectionString = e2eConnectionString();

// Guard before anything connects: an integration test must never write to the
// developer's database.
assertNotDevDatabase(connectionString);
process.env.POSTGRES_URL = connectionString;

beforeAll(async () => {
  // Reset unconditionally rather than trusting a leftover database. Seeding is
  // a handful of rows, so the cost is negligible and a stale row can never
  // leak into an assertion.
  await resetDatabase();
  await seedDatabase();

  console.log(`[integration] seeded ${E2E_DATABASE}`);
});
