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

export const connectionString = process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    "Missing database connection string: set POSTGRES_URL in .env",
  );
}

export const sql = postgres(connectionString, { ssl: false });
