// tests/fixtures/load.ts
//
// Reads the fixture profile from the shared, normative
// `spec/snapshots/<profile>/` — the same CSV source every app variant uses to
// seed a database. Nothing here is imported by the app itself: this is test
// infrastructure only.
//
// Unquoted CSV, exactly like spec/seed-spec.md: fixture values never contain
// commas, quotes or newlines.

import { readFileSync } from "node:fs";
import path from "node:path";

import { snapshotsDirectory } from "../../src/db/spec-dir.ts";

/** Fixture profile the app's test tiers assert against. */
export const FIXTURE_PROFILE = "correctness";

export const fixtureDirectory = path.join(snapshotsDirectory, FIXTURE_PROFILE);

function parseCsv(file: string): Record<string, string>[] {
  // Normalise CRLF before splitting. A checkout that carries \r would leave it
  // glued to the last column name (`email\r`), so the header and the rows
  // disagree about the final column and every row's last value reads back as
  // undefined — which then cascades into any row built from it.
  const [header, ...lines] = readFileSync(
    path.join(fixtureDirectory, file),
    "utf8",
  )
    .replace(/\r\n/g, "\n")
    .trimEnd()
    .split("\n");

  // A file with no trailing newline leaves one empty fragment behind.
  const rows = lines.filter((line) => line.length > 0);

  const columns = header.split(",").map((column) => column.trim());

  return rows.map((line) => {
    const values = line.split(",");
    const row: Record<string, string> = {};

    columns.forEach((column, index) => {
      row[column] = values[index];
    });

    return row;
  });
}

/**
 * Raw rows keyed by table name, for `COPY`-style bulk insertion. The rows match
 * the schema column names exactly, which is the contract `COPY ... header true`
 * relies on.
 */
export function loadRawRows() {
  return {
    users: parseCsv("users.csv"),
    projects: parseCsv("projects.csv"),
    tasks: parseCsv("tasks.csv"),
    comments: parseCsv("comments.csv"),
  };
}

/** Fixture table names in foreign-key-safe insertion order. */
export const FIXTURE_TABLES = [
  "users",
  "projects",
  "tasks",
  "comments",
] as const;
