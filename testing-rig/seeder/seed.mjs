#!/usr/bin/env node
// Canonical fixture loader (plan §3.2).
//
// Modes:
//   seed  [profile]   drop → schema → generate → COPY → setval → verify; prints JSON
//   reset             drop → schema only; prints JSON
//   verify [profile]  export + hash; prints JSON
//
// The fixture is either an explicit params blob (env SEED_FIXTURE, JSON — the
// experiment config's `fixture:` object) or a named profile (argv / env
// SEED_PROFILE). Everything is emitted as one JSON line on stdout so the
// controller can parse it without scraping prose.
//
// This image never walks to the repo's spec/: the normative schema and the
// canonical generator are *copied* into this build context, and a rig test
// asserts the copies stay byte-identical to their sources (plan §3.2/§1).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import pg from "pg";
import copyStreams from "pg-copy-streams";

const { Client } = pg;
const { from: copyFrom, to: copyTo } = copyStreams;

const here = path.dirname(fileURLToPath(import.meta.url));
const EXPORT = JSON.parse(readFileSync(path.join(here, "canonical-export.json"), "utf8"));
const SCHEMA_PATH = path.join(here, "schema.sql");
const GENERATOR_PATH = path.join(here, "generate-fixture.mjs");
const TABLES = EXPORT.tables;

const [mode, profileArg] = process.argv.slice(2);

const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

function connectionString() {
  const url = process.env.POSTGRES_URL;
  if (!url) die("POSTGRES_URL is required");
  return url;
}

async function connect() {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();
  return client;
}

/** `database-recreate` (plan §5): a clean schema, no data. */
async function recreateSchema(client) {
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query(readFileSync(SCHEMA_PATH, "utf8"));
}

function generateFixture({ profile, params, out }) {
  const args = [GENERATOR_PATH, "--profile", profile, "--out", out];
  if (params) args.push("--params", JSON.stringify(params));
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (result.status !== 0) {
    die(`fixture generator failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8"));
}

async function copyTable(client, table, filePath) {
  const stream = client.query(
    copyFrom(`COPY ${table} FROM STDIN WITH (FORMAT csv, HEADER true)`),
  );
  await pipeline(createReadStream(filePath), stream);
}

/** Explicit-id fixture rows bypass the identity sequences; advance past them. */
async function advanceSequences(client) {
  for (const table of TABLES) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT max(id) FROM ${table}), 1))`,
    );
  }
}

async function rowCounts(client) {
  const counts = {};
  for (const table of TABLES) {
    const { rows } = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
    counts[table] = rows[0].count;
  }
  return counts;
}

/** Export the canonical CSV per table (in `order`) and hash the concatenation. */
async function exportDigest(client) {
  const combined = createHash("sha256");
  const perTable = {};
  for (const table of TABLES) {
    const tableHash = createHash("sha256");
    const stream = client.query(
      copyTo(`COPY (${EXPORT.select[table]}) TO STDOUT WITH (FORMAT csv, HEADER true)`),
    );
    for await (const chunk of stream) {
      combined.update(chunk);
      tableHash.update(chunk);
    }
    perTable[table] = tableHash.digest("hex");
  }
  return { combinedSha256: combined.digest("hex"), perTableSha256: perTable };
}

async function main() {
  const client = await connect();
  try {
    if (mode === "reset") {
      await recreateSchema(client);
      emit({ mode, reset: true });
      return;
    }

    if (mode === "verify") {
      const counts = await rowCounts(client);
      const digest = await exportDigest(client);
      emit({ mode, profile: profileArg ?? null, rowCounts: counts, ...digest });
      return;
    }

    if (mode === "seed") {
      const paramsJson = process.env.SEED_FIXTURE;
      const profile = paramsJson ? "custom" : (profileArg ?? process.env.SEED_PROFILE ?? "small");
      const params = paramsJson ? JSON.parse(paramsJson) : undefined;

      const out = mkdtempSync(path.join(tmpdir(), "bench-fixture-"));
      try {
        const manifest = generateFixture({ profile, params, out });
        await recreateSchema(client);
        for (const table of TABLES) {
          await copyTable(client, table, path.join(out, `${table}.csv`));
        }
        await advanceSequences(client);

        const counts = await rowCounts(client);
        const digest = await exportDigest(client);
        const rowCountsMatch = TABLES.every((t) => counts[t] === manifest.rowCounts[t]);
        const digestMatches = digest.combinedSha256 === manifest.combinedSha256;

        emit({
          mode,
          profile: manifest.profile,
          params: manifest.params,
          expectedRowCounts: manifest.rowCounts,
          rowCounts: counts,
          expectedCombinedSha256: manifest.combinedSha256,
          combinedSha256: digest.combinedSha256,
          perTableSha256: digest.perTableSha256,
          rowCountsMatch,
          digestMatches,
          eligibility: manifest.eligibility,
        });

        if (!rowCountsMatch || !digestMatches) process.exit(2);
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
      return;
    }

    die(`unknown mode '${mode ?? ""}' (expected: seed | reset | verify)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => die(err?.stack ?? String(err)));
