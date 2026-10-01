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
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";


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

    for await (const chunk of createReadStream(
      path.join(profileDirectory, file.name),
    )) {
      hash.update(chunk as Buffer);
    }

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

/** Stream one CSV file into an open `COPY ... FROM STDIN` connection. */
async function copyFile(
  tx: postgres.TransactionSql,
  table: Table,
  filePath: string,
): Promise<void> {
  // `header true` makes Postgres skip the CSV header row. The table name is
  // passed as an identifier, so it is escaped rather than interpolated.
  const writable =
    await tx`copy ${tx(table)} from stdin with (format csv, header true)`.writable();
  await pipeline(createReadStream(filePath), writable);
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
      await tx`truncate table ${tx(["comments", "tasks", "projects", "users"])} restart identity cascade`;

      for (const table of TABLES) {
        const file = manifest.files.find(
          (candidate) => candidate.name === `${table}.csv`,
        );

        if (!file) {
          throw new Error(`Profile "${profile}" is missing ${table}.csv`);
        }

        await copyFile(tx, table, path.join(profileDirectory, file.name));
      }

      // Fixture rows carry explicit ids, which bypass the identity sequences.
      // Advance them past the loaded rows or the next live insert collides.
      for (const table of TABLES) {
        await tx`select setval(
          pg_get_serial_sequence(${table}, 'id'),
          coalesce((select max(id) from ${tx(table)}), 1)
        )`;
      }

      for (const table of TABLES) {
        const [row] = await tx`select count(*)::int as count from ${tx(table)}`;
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
