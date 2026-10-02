// src/db/seed.ts
//
// Loads a canonical fixture profile from `spec/snapshots/<profile>/` into
// Postgres, so every app variant ends up with identical rows
// (spec/seed-spec.md). The profile is a CLI argument:
//
//   pnpm db:seed            # defaults to "small"
//   pnpm db:seed small
//   pnpm db:seed medium
//   pnpm db:seed large
//
// SEED_PROFILE is also honoured. The CSVs are the single source of truth — this
// script never generates rows itself, so it cannot drift from the golden
// digests the benchmark rig verifies.
//
// Rows go in as batched multi-row INSERT. `pg` has no writable-stream API for
// `COPY … FROM STDIN` (that needs pg-copy-streams), and the largest profile is
// 1,000 rows per table, where batching costs nothing measurable.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { Client, escapeIdentifier } from "pg";

import { connectionString } from "@/lib/connection";

import { snapshotsDirectory } from "./spec-dir";

const DEFAULT_PROFILE = "small";

/**
 * Rows per multi-row INSERT.
 *
 * Values are sent as bind parameters and Postgres caps a statement at 65535 of
 * them. The widest table is `tasks` at 8 columns, so 1000 rows is 8000
 * parameters — well inside the limit, and it keeps the peak memory of any
 * profile bounded regardless of how large it grows.
 */
const INSERT_BATCH = 1000;

// Insertion order respects the foreign keys: projects and users before tasks,
// tasks before comments.
const TABLES = ["users", "projects", "tasks", "comments"] as const;

type Table = (typeof TABLES)[number];

type ManifestFile = { name: string; rows: number; sha256: string };

type Manifest = {
  profile: string;
  files: ManifestFile[];
  rowCounts: Record<Table, number>;
};

function resolveProfile(): string {
  const positional = process.argv
    .slice(2)
    .filter((argument) => !argument.startsWith("-"));

  if (positional.length > 1) {
    throw new Error(
      `Expected at most one profile argument, received: ${positional.join(", ")}`,
    );
  }

  return positional[0] ?? process.env.SEED_PROFILE ?? DEFAULT_PROFILE;
}

/** Available profiles are exactly the directories under `spec/snapshots/`. */
function availableProfiles(): string[] {
  return readdirSync(snapshotsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function loadManifest(profile: string): Manifest {
  const profileDirectory = path.join(snapshotsDirectory, profile);

  if (!existsSync(profileDirectory)) {
    throw new Error(
      `Unknown seed profile "${profile}".\n` +
        `Available: ${availableProfiles().join(", ") || "none"}\n` +
        `Expected fixtures at: ${profileDirectory}\n` +
        `Generate them with:\n` +
        `  node testing-rig/src/fixtures/generate-fixture.mjs --profile ${profile} --out spec/snapshots/${profile}`,
    );
  }

  const manifestPath = path.join(profileDirectory, "manifest.json");

  if (!existsSync(manifestPath)) {
    throw new Error(
      `Missing manifest for profile "${profile}": ${manifestPath}`,
    );
  }

  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

/**
 * Fail before touching the database if a CSV no longer matches its recorded
 * digest — otherwise a corrupt fixture would seed quietly-wrong rows.
 *
 * The digest is taken over LF-normalised bytes. `manifest.json` records the
 * files as committed, and this repository is checked out with
 * `core.autocrlf=true` on at least one contributor's machine, which rewrites
 * every CSV to CRLF. Hashing the raw file would then fail on an unmodified
 * checkout — the digest guards against corruption, not against a line-ending
 * convention that changes no value.
 */
async function verifyDigests(
  profileDirectory: string,
  files: ManifestFile[],
): Promise<void> {
  for (const file of files) {
    const normalised = readFileSync(
      path.join(profileDirectory, file.name),
      "utf8",
    )
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

    const actual = createHash("sha256").update(normalised).digest("hex");

    if (actual !== file.sha256) {
      throw new Error(
        `Digest mismatch for ${file.name}\n` +
          `  expected ${file.sha256}\n` +
          `  actual   ${actual}\n` +
          `The fixtures are corrupt or were regenerated; re-run the generator.`,
      );
    }
  }

  console.log(`Verified ${files.length} fixture digests`);
}

/**
 * Minimal CSV reader.
 *
 * spec/seed-spec.md is explicit that fixture values never contain commas,
 * quotes or newlines, which is the same assumption `COPY … WITH (FORMAT CSV)`
 * would have had to make about these files anyway — so this stays small rather
 * than pulling in a parser.
 */
function readCsv(filePath: string): { columns: string[]; rows: string[][] } {
  const [header, ...lines] = readFileSync(filePath, "utf8")
    .trimEnd()
    // Line-ending agnostic: a checkout with `core.autocrlf=true` rewrites these
    // to CRLF, and a stray \r would silently corrupt the last column.
    .split(/\r?\n/);

  return {
    columns: header.split(",").map((column) => column.trim()),
    rows: lines.map((line) => line.split(",")),
  };
}

/** Insert one CSV's rows in batches. */
async function insertFile(
  client: Client,
  table: Table,
  filePath: string,
): Promise<number> {
  const { columns, rows } = readCsv(filePath);

  if (rows.length === 0) {
    throw new Error(`${filePath} contains no data rows.`);
  }

  const quotedColumns = columns
    .map((column) => escapeIdentifier(column))
    .join(", ");

  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH) {
    const batch = rows.slice(offset, offset + INSERT_BATCH);

    // One placeholder per value per row: ($1,$2),($3,$4),...
    const placeholders = batch
      .map((_, rowIndex) => {
        const start = rowIndex * columns.length + 1;

        return `(${columns.map((__, i) => `$${start + i}`).join(",")})`;
      })
      .join(",");

    await client.query(
      `insert into ${escapeIdentifier(table)} (${quotedColumns}) values ${placeholders}`,
      batch.flat(),
    );
  }

  return rows.length;
}

async function main(): Promise<void> {
  const profile = resolveProfile();
  const profileDirectory = path.join(snapshotsDirectory, profile);
  const manifest = loadManifest(profile);

  console.log(`Seeding profile "${profile}"`);
  await verifyDigests(profileDirectory, manifest.files);

  const client = new Client({ connectionString });

  try {
    await client.connect();

    await client.query("BEGIN");

    // Truncating the leaves with CASCADE clears the whole graph in one
    // statement, in FK-safe order.
    await client.query(
      `truncate table ${["comments", "tasks", "projects", "users"]
        .map((table) => escapeIdentifier(table))
        .join(", ")} restart identity cascade`,
    );

    for (const table of TABLES) {
      const file = manifest.files.find(
        (candidate) => candidate.name === `${table}.csv`,
      );

      if (!file) {
        throw new Error(`Profile "${profile}" is missing ${table}.csv`);
      }

      await insertFile(client, table, path.join(profileDirectory, file.name));
    }

    // Fixture rows carry explicit ids, which bypass the identity sequences.
    // Advance them past the loaded rows or the next live insert collides.
    for (const table of TABLES) {
      await client.query(
        `select setval(
           pg_get_serial_sequence($1, 'id'),
           coalesce((select max(id) from ${escapeIdentifier(table)}), 1)
         )`,
        [table],
      );
    }

    for (const table of TABLES) {
      const result = await client.query<{ count: number }>(
        `select count(*)::int as count from ${escapeIdentifier(table)}`,
      );
      const actual = result.rows[0].count;
      const expected = manifest.rowCounts[table];

      if (actual !== expected) {
        throw new Error(
          `Row count mismatch for ${table}: expected ${expected}, loaded ${actual}`,
        );
      }

      console.log(`  ${table}: ${actual} rows`);
    }

    await client.query("COMMIT");

    console.log(`Seeding complete (profile "${profile}")`);
  } catch (error) {
    // Never leave a half-seeded database behind: a truncated table set with
    // some fixtures loaded is worse than the pre-seed state.
    await client.query("ROLLBACK").catch(() => {});

    throw error;
  } finally {
    await client.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
