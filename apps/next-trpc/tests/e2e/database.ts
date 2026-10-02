// tests/e2e/database.ts
//
// Lifecycle for the e2e database.
//
// This app's e2e suite runs against its OWN database — `..._e2e` on the same
// Postgres server — created, migrated, seeded and dropped around the run. The
// developer's database is never read or written, so a failing (or mutating)
// test run cannot disturb local work, and dev data changes cannot break the
// suite.
//
// The dataset is `tests/fixtures/correctness/*.csv`, shared with the unit
// fixtures via tests/fixtures/load.ts. Nothing here is imported by the app
// itself: this file is test infrastructure only.

import { existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import postgres from "postgres";

import { withoutPrismaSchemaParam } from "../../src/lib/db";
import { schemaPath } from "../../src/db/spec-dir";
import { fixtureDirectory } from "../fixtures/load";

export const E2E_DATABASE = "architecture_next_actions_e2e";
export const E2E_PORT = 3100;

/**
 * Connection string for the e2e database.
 *
 * Derived from the developer's `POSTGRES_URL` by swapping only the database
 * name, so both live on the same server and the same credentials apply. Falls
 * back to a local socket default when `.env` is absent.
 */
export function e2eConnectionString(): string {
  // The developer's connection string is the source of truth for host and
  // credentials; only the database name differs. Next.js loads `.env` itself,
  // but global-setup runs outside the app, so it is read here.
  const envPath = path.join(process.cwd(), ".env");

  if (!process.env.POSTGRES_URL && existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const base = process.env.POSTGRES_URL;

  if (!base) {
    throw new Error(
      "Missing POSTGRES_URL: set it in .env so the e2e database can be created.",
    );
  }

  const url = new URL(base);
  url.pathname = `/${E2E_DATABASE}`;

  // The shared .env may carry Prisma's `?schema=public`, which postgres.js
  // would forward to the server as a startup GUC and Postgres rejects. Every
  // connection made below — admin, migration, seed, and the web server's — is
  // derived from this string, so strip it once, here.
  return withoutPrismaSchemaParam(url.toString());
}

/** Connection string for the maintenance database, used to CREATE/DROP DATABASE. */
function adminConnectionString(): string {
  const url = new URL(e2eConnectionString());
  url.pathname = "/postgres";

  return url.toString();
}

/**
 * Drop and recreate the e2e database, then apply the schema.
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

/** Load the shared fixture into the e2e database. */
export async function seedDatabase(): Promise<void> {
  const sql = postgres(e2eConnectionString(), { ssl: false });

  try {
    // `COPY ... FROM STDIN` streams the fixture CSVs straight in, which is both
    // the fastest path and the one `src/db/seed.ts` already uses for the dev
    // database — so the two seeders cannot diverge in behaviour. The fixture
    // header rows already match the schema column names exactly, which is the
    // same contract spec/seed-spec.md relies on.
    //
    // The profile is the shared `spec/snapshots/correctness/` fixture, not a
    // copy kept inside this app.
    //
    // Insertion order respects the foreign keys.
    const tables = ["users", "projects", "tasks", "comments"] as const;

    await sql.begin(async (tx) => {
      for (const table of tables) {
        const writable =
          await tx`copy ${tx(table)} from stdin with (format csv, header true)`.writable();
        await pipeline(
          createReadStream(path.join(fixtureDirectory, `${table}.csv`)),
          writable,
        );
      }

      // The fixture carries explicit ids, which bypass the identity sequences.
      // Advance them past the loaded rows or the next live insert collides.
      for (const table of tables) {
        await tx`select setval(pg_get_serial_sequence(${table}, 'id'), coalesce((select max(id) from ${tx(table)}), 1))`;
      }
    });
  } finally {
    await sql.end();
  }
}

/** Remove the e2e database entirely. Best-effort: never fails the run. */
export async function dropDatabase(): Promise<void> {
  const admin = postgres(adminConnectionString(), { ssl: false });

  try {
    await admin.unsafe(`drop database if exists ${E2E_DATABASE} with (force)`);
  } catch (error) {
    console.warn(
      `[e2e] could not drop ${E2E_DATABASE}: ${
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
        `Got ${connectionString}. The e2e suite must never touch the dev database.`,
    );
  }
}
