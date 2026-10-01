// src/lib/connection.ts
//
// The one place `POSTGRES_URL` is read and normalised. Split out from `db.ts`
// so a caller that only needs the connection string — the Drizzle client —
// does not have to import the postgres.js pool, which would open a connection as
// a side effect of merely resolving the URL.
//
// The string helpers themselves live in `connection-string.ts`, which is free of
// side effects, so the e2e database lifecycle can use them without triggering
// this module's eager read of the environment.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normaliseConnectionString } from "./connection-string";

// Next.js loads `.env` automatically, but standalone scripts (migrate, seed) and
// the Vitest `setupFiles` entry that repoints this process at the e2e database do
// not. Load it here so both paths resolve the same connection string.
const envPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".env",
);

if (existsSync(envPath) && !process.env.POSTGRES_URL) {
  process.loadEnvFile(envPath);
}

const rawConnectionString = process.env.POSTGRES_URL;

if (!rawConnectionString) {
  throw new Error(
    "Missing database connection string: set POSTGRES_URL in .env",
  );
}

/**
 * Resolved eagerly so a misconfigured environment fails at import, in one place,
 * rather than at the first query.
 */
export const connectionString = normaliseConnectionString(rawConnectionString);
