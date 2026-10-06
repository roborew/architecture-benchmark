// src/db/seed.ts
//
// Loads the shared fixture profile (`spec/snapshots/correctness/`) into the
// database named by POSTGRES_URL via `COPY ... FROM STDIN`, so the dev database
// holds byte-identical rows to what every test tier asserts against
// (spec/seed-spec.md). The CSVs are the single source of truth — this script
// never generates rows itself.

import { createReadStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { requirePostgresUrl } from "../config/env.ts";
import { createConnection } from "./connection.ts";
import { snapshotsDirectory } from "./spec-dir.ts";

const PROFILE = "correctness";

// Insertion order respects the foreign keys.
const TABLES = ["users", "projects", "tasks", "comments"] as const;

const fixtureDirectory = path.join(snapshotsDirectory, PROFILE);

const sql = createConnection(requirePostgresUrl());

try {
  await sql.begin(async (tx) => {
    for (const table of TABLES) {
      const writable =
        await tx`copy ${tx(table)} from stdin with (format csv, header true)`.writable();
      await pipeline(
        createReadStream(path.join(fixtureDirectory, `${table}.csv`)),
        writable,
      );
    }

    // The fixture carries explicit ids, which bypass the identity sequences.
    // Advance them past the loaded rows or the next live insert collides.
    for (const table of TABLES) {
      await tx`select setval(pg_get_serial_sequence(${table}, 'id'), coalesce((select max(id) from ${tx(table)}), 1))`;
    }
  });
  console.log(`Seeded profile "${PROFILE}" from ${fixtureDirectory}`);
} finally {
  await sql.end();
}
