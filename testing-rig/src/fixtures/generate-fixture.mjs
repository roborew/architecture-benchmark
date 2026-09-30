#!/usr/bin/env node
// Canonical fixture generator — implements spec/seed-spec.md (algorithm v1).
//
// Deliberately dependency-free plain Node so it runs before `pnpm install`.
// Profiles embed the same values as spec/seed-profiles.yaml and must stay in
// sync (the rig's conformance validator checks digests against
// spec/snapshots/<profile>/manifest.json).
//
// Usage:
//   node generate-fixture.mjs --profile small --out spec/snapshots/small
//   node generate-fixture.mjs --profile custom --params '{"projectCount":5,...}' --out dir

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { resolve } from "node:path";

const SEED_VERSION = 1;

const PROFILES = {
  small: {
    seedVersion: 1,
    seed: 42,
    projectCount: 5,
    userCount: 20,
    taskCount: 1000,
    commentCount: 1000,
    baseTimestamp: "2025-01-01T00:00:00Z",
    statusPercent: { todo: 50, doing: 30, done: 20 },
    workingSetFraction: 0.2,
  },
  medium: {
    seedVersion: 1,
    seed: 42,
    projectCount: 50,
    userCount: 200,
    taskCount: 50000,
    commentCount: 100000,
    baseTimestamp: "2025-01-01T00:00:00Z",
    statusPercent: { todo: 50, doing: 30, done: 20 },
    workingSetFraction: 0.2,
  },
  large: {
    seedVersion: 1,
    seed: 42,
    projectCount: 200,
    userCount: 1000,
    taskCount: 500000,
    commentCount: 1000000,
    baseTimestamp: "2025-01-01T00:00:00Z",
    statusPercent: { todo: 50, doing: 30, done: 20 },
    workingSetFraction: 0.2,
  },
};

const STATUS_ORDER = ["todo", "doing", "done"];

function parseArgs(args) {
  const out = { profile: null, out: null, params: null };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (key === "--profile") out.profile = value;
    else if (key === "--out") out.out = value;
    else if (key === "--params") out.params = JSON.parse(value);
    else {
      console.error(`unknown argument: ${key}`);
      exit(2);
    }
  }
  if (!out.profile || !out.out) {
    console.error(
      "usage: generate-fixture.mjs --profile <name> --out <dir> [--params <json>]",
    );
    exit(2);
  }
  return out;
}

function validateParams(p) {
  if (p.seedVersion !== SEED_VERSION)
    throw new Error(`seedVersion must be ${SEED_VERSION}`);
  for (const k of ["projectCount", "userCount", "taskCount"]) {
    if (!Number.isInteger(p[k]) || p[k] < 1)
      throw new Error(`${k} must be an integer >= 1`);
  }
  if (!Number.isInteger(p.commentCount) || p.commentCount < 0) {
    throw new Error("commentCount must be an integer >= 0");
  }
  if (!Number.isInteger(p.seed)) throw new Error("seed must be an integer");
  const base = new Date(p.baseTimestamp);
  if (Number.isNaN(base.getTime()) || base.getUTCMilliseconds() !== 0) {
    throw new Error(
      "baseTimestamp must be a UTC instant at whole-second precision",
    );
  }
  const sp = p.statusPercent;
  const total = STATUS_ORDER.reduce((sum, s) => {
    if (!Number.isInteger(sp[s]) || sp[s] < 1)
      throw new Error(`statusPercent.${s} must be an integer >= 1`);
    return sum + sp[s];
  }, 0);
  if (total !== 100)
    throw new Error(`statusPercent must sum to 100 (got ${total})`);
  if (!(p.workingSetFraction > 0 && p.workingSetFraction <= 1)) {
    throw new Error("workingSetFraction must be in (0, 1]");
  }
}

function buildStatusCycle(statusPercent) {
  const cycle = [];
  for (const s of STATUS_ORDER) {
    for (let n = 0; n < statusPercent[s]; n += 1) cycle.push(s);
  }
  return cycle; // length 100
}

function isoSecond(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function generateRows(p) {
  const base = new Date(p.baseTimestamp).getTime();
  const cycle = buildStatusCycle(p.statusPercent);
  const second = 1000;

  const users = [];
  for (let id = 1; id <= p.userCount; id += 1) {
    users.push({
      id,
      display_name: `User ${id}`,
      email: `user${id}@example.test`,
    });
  }

  const projects = [];
  for (let id = 1; id <= p.projectCount; id += 1) {
    projects.push({
      id,
      name: `Project ${id}`,
      description: `Description for project ${id}`,
      created_at: isoSecond(new Date(base + (id - 1) * second)),
    });
  }

  const tasks = [];
  for (let i = 1; i <= p.taskCount; i += 1) {
    const createdAt = isoSecond(new Date(base + (i - 1) * second));
    tasks.push({
      id: i,
      project_id: 1 + ((i - 1) % p.projectCount),
      assignee_id: 1 + ((i - 1) % p.userCount),
      title: `Task ${i}`,
      description: `Description for task ${i}`,
      status: cycle[(i - 1) % 100],
      created_at: createdAt,
      updated_at: isoSecond(new Date(base + (i - 1) * second + 60 * second)),
    });
  }

  const comments = [];
  for (let j = 1; j <= p.commentCount; j += 1) {
    const taskId = 1 + ((j - 1) % p.taskCount);
    comments.push({
      id: j,
      task_id: taskId,
      author_id: 1 + ((j - 1) % p.userCount),
      body: `Comment ${j} on task ${taskId}`,
      created_at: isoSecond(
        new Date(base + p.taskCount * second + (j - 1) * second),
      ),
    });
  }

  return { users, projects, tasks, comments };
}

const TABLE_COLUMNS = {
  users: ["id", "display_name", "email"],
  projects: ["id", "name", "description", "created_at"],
  tasks: [
    "id",
    "project_id",
    "assignee_id",
    "title",
    "description",
    "status",
    "created_at",
    "updated_at",
  ],
  comments: ["id", "task_id", "author_id", "body", "created_at"],
};

function toCsv(table, rows) {
  const columns = TABLE_COLUMNS[table];
  const lines = [columns.join(",")];
  for (const row of rows) {
    // Generated values never contain commas/quotes/newlines — no quoting (spec/seed-spec.md).
    lines.push(columns.map((c) => String(row[c])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function eligibility(p) {
  const readPoolSize = Math.floor(p.taskCount / 2);
  return {
    readPool: { from: 1, to: readPoolSize },
    hotSet: { from: 1, to: Math.ceil(readPoolSize * p.workingSetFraction) },
    updatePool: {
      from: readPoolSize + 1,
      to: Math.floor((4 * p.taskCount) / 5),
    },
    deletePool: {
      from: Math.floor((4 * p.taskCount) / 5) + 1,
      to: p.taskCount,
    },
  };
}

function main() {
  const args = parseArgs(argv.slice(2));
  const params =
    args.profile === "custom" || args.params
      ? { ...PROFILES[args.profile], ...args.params }
      : PROFILES[args.profile];
  if (!params) {
    console.error(`unknown profile: ${args.profile}`);
    exit(2);
  }
  validateParams(params);

  const rows = generateRows(params);
  const tables = ["users", "projects", "tasks", "comments"];
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });

  const files = [];
  let combined = createHash("sha256");
  for (const table of tables) {
    const csv = toCsv(table, rows[table]);
    const sha256 = createHash("sha256").update(csv).digest("hex");
    writeFileSync(`${outDir}/${table}.csv`, csv);
    files.push({ name: `${table}.csv`, rows: rows[table].length, sha256 });
    combined.update(csv);
  }

  const sums = files.map((f) => `${f.sha256}  ${f.name}`).join("\n");
  writeFileSync(`${outDir}/SHA256SUMS`, `${sums}\n`);

  const manifest = {
    schemaVersion: 1,
    seedSpecVersion: SEED_VERSION,
    profile: args.profile,
    params,
    rowCounts: {
      users: rows.users.length,
      projects: rows.projects.length,
      tasks: rows.tasks.length,
      comments: rows.comments.length,
    },
    files,
    combinedSha256: combined.digest("hex"),
    eligibility: eligibility(params),
  };
  writeFileSync(
    `${outDir}/manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    `wrote ${outDir}: ${manifest.rowCounts.tasks} tasks, ${manifest.rowCounts.comments} comments`,
  );
  console.log(`combinedSha256: ${manifest.combinedSha256}`);
}

main();
