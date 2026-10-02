import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

// Next.js loads `.env` automatically, but standalone scripts (migrate, seed)
// do not. Load it here so both paths resolve the same connection string.
const envPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".env",
);
if (existsSync(envPath) && !process.env.POSTGRES_URL) {
  process.loadEnvFile(envPath);
}

const baseConnectionString = process.env.POSTGRES_URL;

if (!baseConnectionString) {
  throw new Error(
    "Missing database connection string: set POSTGRES_URL in .env",
  );
}

/**
 * Drops the Prisma-only `?schema=public` from the connection string.
 *
 * `POSTGRES_URL` is shared with `prisma.ts`, and Prisma requires the `schema`
 * parameter. `postgres.js` has no such concept: it passes every unrecognised
 * query parameter straight through to the server as a startup GUC, so Postgres
 * rejects the connection with
 * `unrecognized configuration parameter "schema"` (42704). Its own driver
 * ignores the parameter, which is why only this module fails.
 *
 * The schema is `public` either way, so removing the parameter changes nothing
 * about which rows are reachable — it only stops the connection from being
 * refused.
 */
function withoutSchemaParam(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.delete("schema");

  return url.toString();
}

export const sql = postgres(withoutSchemaParam(baseConnectionString), {
  ssl: false,
});
