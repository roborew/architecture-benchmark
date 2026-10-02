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

/**
 * Drop Prisma's `?schema=public` if it rode along on POSTGRES_URL.
 *
 * This .env is shared with a Prisma-based sibling app, and Prisma's tooling
 * appends `?schema=public` to its connection string. postgres.js forwards every
 * query parameter it does not recognise to the server as a startup GUC, and
 * Postgres refuses the connection:
 *
 *   PostgresError: unrecognized configuration parameter "schema" (42704)
 *
 * Returns the input untouched when the parameter is absent, or when the string
 * is not a URL we can parse, so the common case costs nothing and cannot be
 * broken by this function.
 */
export function withoutPrismaSchemaParam(connectionString: string): string {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }

  if (!url.searchParams.has("schema")) return connectionString;

  url.searchParams.delete("schema");
  return url.toString();
}

const connectionString = process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    "Missing database connection string: set POSTGRES_URL in .env",
  );
}

export const sql = postgres(withoutPrismaSchemaParam(connectionString), {
  ssl: false,
});
