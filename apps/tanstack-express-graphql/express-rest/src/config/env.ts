// src/config/env.ts
//
// Environment resolution, in one place. Standalone scripts and vitest do not
// load `.env` automatically (only `node --env-file` does), so it is read here —
// every path (server, scripts, tests) resolves the same variables.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".env",
);

if (existsSync(envPath) && !process.env.POSTGRES_URL) {
  process.loadEnvFile(envPath);
}

export const env = {
  /** Postgres connection string; the one source of truth for host + credentials. */
  POSTGRES_URL: process.env.POSTGRES_URL ?? "",
  /** HTTP port the standalone server listens on. */
  PORT: Number(process.env.PORT ?? 4000),
} as const;

export function requirePostgresUrl(override?: string): string {
  const url = override ?? env.POSTGRES_URL;

  if (!url) {
    throw new Error(
      "Missing database connection string: set POSTGRES_URL in .env",
    );
  }

  return url;
}
