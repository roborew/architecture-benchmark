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
//
// Connections go through `createClient` from `src/lib/db`, which is built on
// `pg` — the same driver Prisma uses — so the project has one Postgres client
// rather than two.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "../../src/lib/db";

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

  return url.toString();
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
 *
 * `CREATE DATABASE` cannot run inside a transaction or a pool that is bound to
 * the target database, hence the separate one-shot admin client.
 */
export async function resetDatabase(): Promise<void> {
  const admin = createClient(adminConnectionString());

  try {
    // The database name is an identifier, not a bind parameter — Postgres does
    // not accept one in DROP/CREATE DATABASE. It comes from a module constant,
    // never from user input.
    await admin.unsafe(
      `drop database if exists "${E2E_DATABASE}" with (force)`,
    );
    await admin.unsafe(`create database "${E2E_DATABASE}"`);
  } finally {
    await admin.end();
  }

  const sql = createClient(e2eConnectionString());

  try {
    await sql.file(schemaPath);
  } finally {
    await sql.end();
  }
}

/**
 * Splits one CSV file into its column names and row objects.
 *
 * Deliberately the same shape the vitest fixture loader produces, so the two
 * seeders cannot disagree about what a row is. Values are passed to Postgres as
 * bind parameters, so no escaping is needed and a value containing a comma
 * would still be handled correctly.
 */
function parseCsv(file: string): { columns: string[]; rows: string[][] } {
  const [header, ...lines] = readFileSync(
    path.join(fixtureDirectory, file),
    "utf8",
  )
    // Normalise CRLF before splitting, or the last column would be named
    // `email\r` and every insert would fail on an unknown column.
    .replace(/\r\n/g, "\n")
    .trimEnd()
    .split("\n");

  return {
    columns: header.split(","),
    rows: lines.map((line) => line.split(",")),
  };
}

/** Load the shared fixture into the e2e database. */
export async function seedDatabase(): Promise<void> {
  const sql = createClient(e2eConnectionString());

  try {
    // Insertion order respects the foreign keys: users and projects before
    // tasks, tasks before comments.
    //
    // The profile is the shared `spec/snapshots/correctness/` fixture, not a
    // copy kept inside this app.
    const tables = ["users", "projects", "tasks", "comments"] as const;

    await sql.begin(async (tx) => {
      for (const table of tables) {
        const { columns, rows } = parseCsv(`${table}.csv`);

        if (rows.length === 0) continue;

        // One multi-row INSERT rather than `COPY ... FROM STDIN`: the fixture is
        // three projects and six tasks, so the streaming protocol would buy
        // nothing and would need a second driver to speak it.
        //
        // Identifiers are quoted rather than bound because Postgres has no bind
        // slot for a column name; the values themselves are all bound, so the
        // fixture's contents are never concatenated into the statement.
        const columnList = tx.identifier(columns).__raw;
        // Placeholders are numbered across the whole statement, not per row:
        // `VALUES ($1,$2,$3),($4,$5,$6)` needs six distinct slots, so the
        // counter must keep running as tuples are emitted.
        const tuples = rows
          .map((_, rowIndex) => {
            const slots = columns.map(
              (_, columnIndex) =>
                `$${rowIndex * columns.length + columnIndex + 1}`,
            );
            return `(${slots.join(", ")})`;
          })
          .join(", ");
        const values = rows.flat();

        await tx.query(
          `INSERT INTO "${table}" (${columnList}) VALUES ${tuples}`,
          values,
        );
      }

      // The fixture carries explicit ids, which bypass the identity sequences.
      // Advance them past the loaded rows or the next live insert collides.
      for (const table of tables) {
        await tx`select setval(pg_get_serial_sequence(${table}, 'id'), coalesce((select max(id) from ${tx.identifier(table)}), 1))`;
      }
    });
  } finally {
    await sql.end();
  }
}

/** Remove the e2e database entirely. Best-effort: never fails the run. */
export async function dropDatabase(): Promise<void> {
  const admin = createClient(adminConnectionString());

  try {
    await admin.unsafe(
      `drop database if exists "${E2E_DATABASE}" with (force)`,
    );
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
