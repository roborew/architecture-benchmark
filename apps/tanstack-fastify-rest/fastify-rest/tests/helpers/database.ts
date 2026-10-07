// tests/helpers/database.ts
//
// Lifecycle for the isolated test database.
//
// The integration suite runs against its OWN database —
// `architecture_tanstack_fastify_rest_e2e` on the same Postgres server —
// created, migrated, seeded and dropped around the run. The developer's
// database is never read or written, so a failing (or mutating) test run
// cannot disturb local work, and dev data changes cannot break the suite.
//
// The dataset is `spec/snapshots/correctness/*.csv`, the fixture every app
// variant in this repo shares.

import { existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import postgres from "postgres";

import { schemaPath } from "../../src/db/spec-dir.ts";
import { fixtureDirectory, FIXTURE_TABLES } from "../fixtures/load.ts";

export const E2E_DATABASE = "architecture_tanstack_fastify_rest_e2e";

/**
 * Connection string for the test database.
 *
 * Derived from the developer's `POSTGRES_URL` by swapping only the database
 * name, so both live on the same server and the same credentials apply. Falls
 * back to reading `.env` from the app root when the variable is not exported.
 */
export function e2eConnectionString(): string {
  const envPath = path.join(process.cwd(), ".env");

  if (!process.env.POSTGRES_URL && existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const base = process.env.POSTGRES_URL;

  if (!base) {
    throw new Error(
      "Missing POSTGRES_URL: set it in .env so the test database can be created.",
    );
  }

  const url = new URL(base);
  url.pathname = `/${E2E_DATABASE}`;

  return url.toString();
}

/** Connection string for the maintenance database, used to CREATE/DROP DATABASE. */
function adminConnectionString(): string {
  const url = new URL(e2eConnectionString());
  url.pathname = "/postgres";

  return url.toString();
}

/**
 * Drop and recreate the test database, then apply the schema.
 *
 * DROP rather than TRUNCATE so a previous run's schema can never leak through —
 * the app is under active migration and a stale column would be a confusing
 * failure. `FORCE` also terminates stragglers if a previous dev server is
 * still connected.
 */
export async function resetDatabase(): Promise<void> {
  const admin = postgres(adminConnectionString(), { ssl: false });

  try {
    await admin.unsafe(`
      drop database if exists ${E2E_DATABASE} with (force)
    `);
    await admin.unsafe(`create database ${E2E_DATABASE}`);
  } finally {
    await admin.end();
  }

  const sql = postgres(e2eConnectionString(), { ssl: false });

  try {
    await sql.file(schemaPath);
  } finally {
    await sql.end();
  }
}

/** Load the shared fixture into the test database. */
export async function seedDatabase(): Promise<void> {
  const sql = postgres(e2eConnectionString(), { ssl: false });

  try {
    // `COPY ... FROM STDIN` streams the fixture CSVs straight in — the same
    // path `src/db/seed.ts` uses for the dev database, so the two seeders
    // cannot diverge in behaviour. The fixture header rows already match the
    // schema column names exactly, which is the contract spec/seed-spec.md
    // relies on.
    await sql.begin(async (tx) => {
      for (const table of FIXTURE_TABLES) {
        const writable =
          await tx`copy ${tx(table)} from stdin with (format csv, header true)`.writable();
        await pipeline(
          createReadStream(path.join(fixtureDirectory, `${table}.csv`)),
          writable,
        );
      }

      // The fixture carries explicit ids, which bypass the identity sequences.
      // Advance them past the loaded rows or the next live insert collides.
      for (const table of FIXTURE_TABLES) {
        await tx`select setval(pg_get_serial_sequence(${table}, 'id'), coalesce((select max(id) from ${tx(table)}), 1))`;
      }
    });
  } finally {
    await sql.end();
  }
}

/** Remove the test database entirely. Best-effort: never fails the run. */
export async function dropDatabase(): Promise<void> {
  const admin = postgres(adminConnectionString(), { ssl: false });

  try {
    await admin.unsafe(`drop database if exists ${E2E_DATABASE} with (force)`);
  } catch (error) {
    console.warn(
      `[test] could not drop ${E2E_DATABASE}: ${
        error instanceof Error ? error.message : error
      }`,
    );
  } finally {
    await admin.end();
  }
}

/** Guard used by tests to assert the app is reading the isolated database. */
export function assertNotDevDatabase(connectionString: string): void {
  if (!connectionString.includes(E2E_DATABASE)) {
    throw new Error(
      `Refusing to run: POSTGRES_URL does not point at ${E2E_DATABASE}. ` +
        `Got ${connectionString}. The test suite must never touch the dev database.`,
    );
  }
}
