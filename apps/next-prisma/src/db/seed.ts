// src/db/seed.ts
//
// Loads a canonical fixture profile from `spec/snapshots/<profile>/` into
// Postgres via `COPY`, so every app variant ends up with byte-identical rows
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

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { sql } from "@/lib/db";

import { snapshotsDirectory } from "./spec-dir";

const DEFAULT_PROFILE = "small";

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
 */
async function verifyDigests(
  profileDirectory: string,
  files: ManifestFile[],
): Promise<void> {
  for (const file of files) {
    const hash = createHash("sha256");
    hash.update(readFileSync(path.join(profileDirectory, file.name)));
    const actual = hash.digest("hex");
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
 * Splits one fixture CSV into its column names and row value arrays.
 *
 * CRLF is normalised first so the last column is not named `email\r`. Values
 * are handed to Postgres as bind parameters, so no value needs escaping.
 */
function parseCsv(filePath: string): { columns: string[]; rows: string[][] } {
  const [header, ...lines] = readFileSync(filePath, "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd()
    .split("\n");

  return { columns: header.split(","), rows: lines.map((l) => l.split(",")) };
}

async function main(): Promise<void> {
  const profile = resolveProfile();
  const profileDirectory = path.join(snapshotsDirectory, profile);
  const manifest = loadManifest(profile);

  console.log(`Seeding profile "${profile}"`);
  await verifyDigests(profileDirectory, manifest.files);

  try {
    await sql.begin(async (tx) => {
      // Truncating the leaves with CASCADE clears the whole graph in one
      // statement, in FK-safe order.
      await tx`truncate table ${tx.identifier(["comments", "tasks", "projects", "users"])} restart identity cascade`;

      for (const table of TABLES) {
        const file = manifest.files.find(
          (candidate) => candidate.name === `${table}.csv`,
        );

        if (!file) {
          throw new Error(`Profile "${profile}" is missing ${table}.csv`);
        }

        // One multi-row INSERT rather than `COPY ... FROM STDIN`. The benchmark
        // profiles are sized for volume, but correctness of the loaded rows is
        // what this script exists to guarantee, and a bound-parameter insert is
        // both transaction-safe and driver-agnostic. Column names are quoted
        // because Postgres has no bind slot for an identifier; values are bound.
        const { columns, rows } = parseCsv(
          path.join(profileDirectory, file.name),
        );

        if (rows.length === 0) continue;

        // Placeholders are numbered across the whole statement, not per row:
        // `VALUES ($1,$2,$3),($4,$5,$6)` needs six distinct slots.
        const tuples = rows
          .map((_, rowIndex) => {
            const slots = columns.map(
              (_, columnIndex) =>
                `$${rowIndex * columns.length + columnIndex + 1}`,
            );
            return `(${slots.join(", ")})`;
          })
          .join(", ");

        await tx.query(
          `INSERT INTO ${tx.identifier(table).__raw} (${tx.identifier(columns).__raw}) ` +
            `VALUES ${tuples}`,
          rows.flat(),
        );
      }

      // Fixture rows carry explicit ids, which bypass the identity sequences.
      // Advance them past the loaded rows or the next live insert collides.
      for (const table of TABLES) {
        await tx`select setval(
          pg_get_serial_sequence(${table}, 'id'),
          coalesce((select max(id) from ${tx.identifier(table)}), 1)
        )`;
      }

      for (const table of TABLES) {
        const { rows: counted } = await tx.query(
          `select count(*)::int as count from ${tx.identifier(table).__raw}`,
        );
        const row = counted[0] as { count: number };
        const expected = manifest.rowCounts[table];

        if (row.count !== expected) {
          throw new Error(
            `Row count mismatch for ${table}: expected ${expected}, loaded ${row.count}`,
          );
        }

        console.log(`  ${table}: ${row.count} rows`);
      }
    });

    console.log(`Seeding complete (profile "${profile}")`);
  } finally {
    await sql.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
