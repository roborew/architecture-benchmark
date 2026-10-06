// tests/e2e/global-teardown.ts
//
// Runs once after the suite and removes the isolated e2e database. Best-effort
// by design: a failure to drop must never fail the run that already passed.

import { dropDatabase } from "./database";

export default async function globalTeardown() {
  await dropDatabase();
}
