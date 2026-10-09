// Independent verification of a seeded stack (plan §5/§3.2): schema facts from
// pg_catalog and a canonical export digest, both read straight from the stack's
// Postgres via `docker compose exec -T db psql`. This never trusts the seeder's
// own report — a seeder bug and a controller bug would have to agree to pass.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Compose } from "./docker.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXPORT = JSON.parse(
  readFileSync(
    path.join(here, "..", "..", "seeder", "canonical-export.json"),
    "utf8",
  ),
) as { tables: string[]; select: Record<string, string> };

export const CANONICAL_TABLES = EXPORT.tables;

/** The five measured indexes the schema must carry (spec/schema.sql). */
export const EXPECTED_INDEXES = [
  "comments_author_id_idx",
  "comments_task_created_id_idx",
  "tasks_assignee_id_idx",
  "tasks_project_created_id_idx",
  "tasks_project_status_created_id_idx",
] as const;

/** Column counts per table — catches a table that drifted from spec/schema.sql. */
const EXPECTED_COLUMNS: Record<string, number> = {
  users: 3,
  projects: 4,
  tasks: 8,
  comments: 5,
};

const SCHEMA_QUERY = `
SELECT json_build_object(
  'indexes', (SELECT coalesce(json_agg(indexname ORDER BY indexname), '[]'::json)
              FROM pg_indexes
              WHERE schemaname = 'public'
                AND indexname = ANY(ARRAY['comments_author_id_idx','comments_task_created_id_idx','tasks_assignee_id_idx','tasks_project_created_id_idx','tasks_project_status_created_id_idx']::text[])),
  'fkRestrict', (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'r'),
  'fkCascade',  (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'c'),
  'fkSetNull',  (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'n'),
  'checks',     (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace),
  'columns',    (SELECT json_object_agg(table_name, cnt) FROM (
                   SELECT table_name, count(*)::int AS cnt
                   FROM information_schema.columns
                   WHERE table_schema = 'public'
                   GROUP BY table_name) t)
);`;

export interface SchemaVerification {
  ok: boolean;
  problems: string[];
  observed: Record<string, unknown>;
}

export interface DigestVerification {
  combinedSha256: string;
  perTableSha256: Record<string, string>;
  expected?: string;
  matches?: boolean;
}

async function psql(compose: Compose, sql: string): Promise<string> {
  const result = await compose.exec(
    "db",
    [
      "psql",
      "-U",
      "bench",
      "-d",
      "bench",
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
      "-c",
      sql,
    ],
    { allowFailure: true },
  );
  if (result.code !== 0) {
    throw new Error(
      `psql failed (${result.code}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

export async function verifySchema(
  compose: Compose,
): Promise<SchemaVerification> {
  const raw = await psql(compose, SCHEMA_QUERY);
  const observed = JSON.parse(raw.trim()) as {
    indexes: string[];
    fkRestrict: number;
    fkCascade: number;
    fkSetNull: number;
    checks: number;
    columns: Record<string, number>;
  };

  const problems: string[] = [];
  const missingIndexes = EXPECTED_INDEXES.filter(
    (name) => !observed.indexes.includes(name),
  );
  if (missingIndexes.length > 0)
    problems.push(`missing indexes: ${missingIndexes.join(", ")}`);
  if (observed.fkRestrict !== 2)
    problems.push(
      `expected 2 ON DELETE RESTRICT FKs, saw ${observed.fkRestrict}`,
    );
  if (observed.fkCascade !== 1)
    problems.push(`expected 1 ON DELETE CASCADE FK, saw ${observed.fkCascade}`);
  if (observed.fkSetNull !== 1)
    problems.push(
      `expected 1 ON DELETE SET NULL FK, saw ${observed.fkSetNull}`,
    );
  if (observed.checks < 3)
    problems.push(`expected >= 3 CHECK constraints, saw ${observed.checks}`);
  for (const [table, count] of Object.entries(EXPECTED_COLUMNS)) {
    if (observed.columns[table] !== count) {
      problems.push(
        `table ${table} has ${observed.columns[table] ?? 0} columns, expected ${count}`,
      );
    }
  }

  return { ok: problems.length === 0, problems, observed };
}

/** Export the canonical CSVs and hash their byte concatenation (spec/seed-spec.md). */
export async function exportDigest(
  compose: Compose,
): Promise<DigestVerification> {
  const combined = createHash("sha256");
  const perTableSha256: Record<string, string> = {};
  for (const table of CANONICAL_TABLES) {
    const stdout = await psql(
      compose,
      `COPY (${EXPORT.select[table]}) TO STDOUT WITH (FORMAT csv, HEADER true)`,
    );
    combined.update(stdout);
    perTableSha256[table] = createHash("sha256").update(stdout).digest("hex");
  }
  return { combinedSha256: combined.digest("hex"), perTableSha256 };
}

export async function verifyDigest(
  compose: Compose,
  expected?: string,
): Promise<DigestVerification> {
  const digest = await exportDigest(compose);
  return {
    ...digest,
    ...(expected
      ? { expected, matches: digest.combinedSha256 === expected }
      : {}),
  };
}
