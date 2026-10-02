// tests/fixtures/load.ts
//
// Reads a fixture profile from the shared, normative `spec/snapshots/<profile>/`
// into typed rows — the same CSV source every app variant uses to seed a
// database.
//
// This is the single source of truth for the app's test data. Both the e2e
// seeder and the `data.ts` generator read through here, so the unit, integration
// and e2e tiers necessarily assert identical rows — the drift that previously
// let the mock dataset and the seeded database disagree can no longer happen.
//
// Unquoted CSV, exactly like spec/seed-spec.md: fixture values never contain
// commas, quotes or newlines.

import { readFileSync } from "node:fs";
import path from "node:path";

import { snapshotsDirectory } from "../../src/db/spec-dir";

/** Fixture profile the app's own test tiers assert against. */
export const FIXTURE_PROFILE = "correctness";

export const fixtureDirectory = path.join(snapshotsDirectory, FIXTURE_PROFILE);

export type FixtureUser = { id: number; display_name: string; email: string };

export type FixtureProject = {
  id: number;
  name: string;
  description: string;
  created_at: string;
};

export type FixtureTask = {
  id: number;
  project_id: number;
  assignee_id: number | null;
  title: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type FixtureComment = {
  id: number;
  task_id: number;
  author_id: number;
  body: string;
  created_at: string;
};

function parseCsv<T>(file: string): T[] {
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

    return row as unknown as T;
  });
}

export function loadUsers() {
  return parseCsv<FixtureUser>("users.csv").map((row) => ({
    id: Number(row.id),
    displayName: row.display_name,
    email: row.email,
  }));
}

export function loadProjects() {
  return parseCsv<FixtureProject>("projects.csv").map((row) => ({
    id: Number(row.id),
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  }));
}

export function loadTasks() {
  return parseCsv<FixtureTask>("tasks.csv").map((row) => ({
    id: Number(row.id),
    projectId: Number(row.project_id),
    // `assignee_id` is nullable in the schema (spec/contract.md), so an empty
    // CSV cell means an unassigned task rather than user 0.
    assigneeId: row.assignee_id == null ? null : Number(row.assignee_id),
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function loadComments() {
  return parseCsv<FixtureComment>("comments.csv").map((row) => ({
    id: Number(row.id),
    taskId: Number(row.task_id),
    authorId: Number(row.author_id),
    body: row.body,
    createdAt: row.created_at,
  }));
}

/**
 * Raw rows keyed by table name, for `COPY`-style bulk insertion. The rows match
 * the schema column names exactly, which is the contract `COPY ... header true`
 * relies on.
 */
export function loadRawRows() {
  return {
    users: parseCsv<Record<string, string>>("users.csv"),
    projects: parseCsv<Record<string, string>>("projects.csv"),
    tasks: parseCsv<Record<string, string>>("tasks.csv"),
    comments: parseCsv<Record<string, string>>("comments.csv"),
  };
}
