// tests/e2e/database.ts
//
// Lifecycle for the e2e database, on `pg` (node-postgres).
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

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Client, escapeIdentifier } from "pg";

import { schemaPath } from "../../src/db/spec-dir";
import { e2eDatabaseUrl } from "../../src/lib/connection-string";
import { fixtureDirectory, loadRawRows } from "../fixtures/load";

export const E2E_DATABASE = "architecture_next_drizzle_e2e";
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

  // Normalised before the database name is swapped, so a Prisma-style
  // `?schema=public` cannot reach node-postgres and abort the CREATE/DROP
  // connection with `unrecognized configuration parameter`.
  return e2eDatabaseUrl(base, E2E_DATABASE);
}

/**
 * Connection string for the maintenance database.
 *
 * `CREATE DATABASE` and `DROP DATABASE` cannot run inside the target they name,
 * so both have to be issued from a different database on the same server.
 */
function adminConnectionString(): string {
  const url = new URL(e2eConnectionString());
  url.pathname = "/postgres";

  return url.toString();
}

/** Run one statement against an arbitrary database, then close cleanly. */
async function runOn(connectionString: string, statement: string) {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    await client.query(statement);
  } finally {
    await client.end();
  }
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
  // The database name is a constant above, never user input, but it is still an
  // identifier: `pg` has no bind parameter for one, so it goes through
  // `escapeIdentifier` rather than string interpolation.
  const database = escapeIdentifier(E2E_DATABASE);

  await runOn(
    adminConnectionString(),
    `drop database if exists ${database} with (force)`,
  );
  await runOn(adminConnectionString(), `create database ${database}`);

  const client = new Client({ connectionString: e2eConnectionString() });

  try {
    await client.connect();
    // `pg` has no `file()` helper the way postgres.js did, so the schema is
    // read and sent as one multi-statement query. `simple query` protocol is
    // what lets several statements share a round trip.
    await client.query({ text: readFileSync(schemaPath, "utf8") });
  } finally {
    await client.end();
  }
}

/** Insertion order respects the foreign keys. */
const TABLES = ["users", "projects", "tasks", "comments"] as const;

/**
 * Rows per multi-row INSERT.
 *
 * `pg` sends values as bind parameters, and Postgres caps a statement at 65535
 * parameters. The widest table here is `tasks` at 8 columns, so 1000 rows is
 * 8000 parameters — comfortably inside the limit with room to spare.
 */
const INSERT_BATCH = 1000;

/** Load the shared fixture into the e2e database. */
export async function seedDatabase(): Promise<void> {
  const client = new Client({ connectionString: e2eConnectionString() });
  const rows = loadRawRows();

  try {
    await client.connect();

    await client.query("BEGIN");

    for (const table of TABLES) {
      const tableRows = rows[table];

      if (tableRows.length === 0) {
        throw new Error(`Fixture ${table}.csv contains no rows.`);
      }

      // The fixture header rows already match the schema column names exactly,
      // which is the contract `COPY ... header true` relied on. The raw loader
      // keeps the column names, so they drive the INSERT rather than a
      // hand-maintained list that could drift from the CSV.
      const columns = Object.keys(tableRows[0]);
      const quotedColumns = columns
        .map((column) => escapeIdentifier(column))
        .join(", ");

      for (let offset = 0; offset < tableRows.length; offset += INSERT_BATCH) {
        const batch = tableRows.slice(offset, offset + INSERT_BATCH);

        // One placeholder per value per row: ($1,$2),($3,$4),...
        const placeholders = batch
          .map((_, rowIndex) => {
            const start = rowIndex * columns.length + 1;

            return `(${columns.map((_, i) => `$${start + i}`).join(",")})`;
          })
          .join(",");

        const values = batch.flatMap((row) =>
          columns.map((column) => row[column]),
        );

        await client.query(
          `insert into ${escapeIdentifier(table)} (${quotedColumns}) values ${placeholders}`,
          values,
        );
      }

      // Fixture rows carry explicit ids, which bypass the identity sequences.
      // Advance them past the loaded rows or the next live insert collides.
      await client.query(
        `select setval(
           pg_get_serial_sequence($1, 'id'),
           coalesce((select max(id) from ${escapeIdentifier(table)}), 1)
         )`,
        [table],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    // Leave no half-seeded database behind: the caller resets unconditionally
    // anyway, but a rollback keeps the failure from looking like a seed that
    // merely inserted fewer rows than expected.
    await client.query("ROLLBACK").catch(() => {});

    throw error;
  } finally {
    await client.end();
  }
}

/** Remove the e2e database entirely. Best-effort: never fails the run. */
export async function dropDatabase(): Promise<void> {
  try {
    await runOn(
      adminConnectionString(),
      `drop database if exists ${escapeIdentifier(E2E_DATABASE)} with (force)`,
    );
  } catch (error) {
    console.warn(
      `[e2e] could not drop ${E2E_DATABASE}: ${
        error instanceof Error ? error.message : error
      }`,
    );
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
