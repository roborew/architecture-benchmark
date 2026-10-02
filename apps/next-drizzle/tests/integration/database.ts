// tests/integration/database.ts
//
// Points the query layer at the isolated e2e database.
//
// `src/lib/connection.ts` reads POSTGRES_URL at import time, so this must run
// before any test imports it — hence a Vitest `setupFiles` entry rather than a
// helper called from inside a test file.
//
// Creating, seeding and dropping the database itself lives in
// `global-setup.ts`, which runs once for the whole project rather than once per
// file. This file only sets the environment variable.

import { assertNotDevDatabase, e2eConnectionString } from "../e2e/database";

const connectionString = e2eConnectionString();

// Guard before anything connects: an integration test must never write to the
// developer's database.
assertNotDevDatabase(connectionString);
process.env.POSTGRES_URL = connectionString;
