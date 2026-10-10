// The per-variant lifecycle state machine (plan §5/§6). One variant = one
// Compose stack. Every stage is timed and recorded; teardown runs in `finally`
// so a failure never leaves containers, networks, or volumes behind, and the
// failure artefacts are written on the way out.

import path from "node:path";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { runCommand, type Compose } from "./docker.js";
import { SEEDER_IMAGE, composeEnv } from "./plan.js";
import { Compose as ComposeClass } from "./docker.js";
import { verifyDigest, verifySchema } from "./verify.js";
import {
  generatorCpuPercent,
  resourceSeriesFile,
  startResourceSampler,
  stopResourceSampler,
  type ResourceSampler,
  type ResourceSummary,
  type SamplerCapture,
} from "./sampler.js";
import type { CapacityScenario } from "../config/schema.js";
import type { FixtureParams } from "./fixture.js";
import type { ResolvedVariant, ResourceCaps } from "./types.js";
import type { RunArtifacts } from "./artifacts.js";

export interface StageRecord {
  ok: boolean;
  ms: number;
  detail?: unknown;
}

/** A recorded k6 threshold label (plan K2) — a health label, never a gate. */
export interface ThresholdResult {
  metric: string;
  expression: string;
  ok: boolean;
}

/** k6's threshold-failure exit code; recorded as a signal, never a stage error. */
const K6_THRESHOLD_EXIT = 99;

export interface SeederReport {
  mode: string;
  profile?: string;
  rowCounts?: Record<string, number>;
  combinedSha256?: string;
  expectedCombinedSha256?: string;
  digestMatches?: boolean;
  rowCountsMatch?: boolean;
  eligibility?: unknown;
}

export interface VariantResult {
  id: string;
  cohort: string;
  status: "ok" | "failed";
  performanceEligible: boolean;
  ports: Record<string, number>;
  stages: Record<string, StageRecord>;
  error?: string;
}

export interface LifecycleOptions {
  rigRoot: string;
  resources: ResourceCaps;
  fixture: FixtureParams;
  artifacts: RunArtifacts;
  /** `false` skips builds entirely; `{noCache:true}` forces a cold build. */
  build?: false | { noCache?: boolean };
  /** Build `bench-seeder:local` before the stack images (once per run). */
  buildSeeder?: boolean;
  /** Run the black-box correctness suite (plan R5) before teardown. */
  correctness?: boolean;
  /** Run the render-speed collector (plan R6). Non-fatal: measurement, not a gate. */
  render?: { warmup: number; measured: number };
  /**
   * Write the raw 1 Hz resource series (`resources/*-samples.json`); the folded
   * aggregates always land in the per-leg reports (plan §3.3).
   */
  keepRawSamples?: boolean;
  /** Run the load generator (plan R7). Non-fatal: measurement. */
  load?: {
    vus: number;
    durationSeconds: number;
    generatorMaxCpuPercent: number;
    /** Volume-scenario mutation load; omit to run read-only. */
    mutations?: {
      counts: {
        list: number;
        detail: number;
        create: number;
        update: number;
        delete: number;
      };
      pools: {
        updateFrom: number;
        updateTo: number;
        deleteFrom: number;
        deleteTo: number;
      };
      readPaths: string[];
    };
    /**
     * Capacity ladder (plan K3): one `constant-arrival-rate` run per declared
     * rate, executed after the read + mutation legs, per variant. Only present
     * when the config declares a `capacity` scenario.
     */
    capacity?: { scenario: CapacityScenario };
  };
  readinessTimeoutMs?: number;
}

export function composeFor(
  variant: ResolvedVariant,
  resources: ResourceCaps,
): ComposeClass {
  return new ComposeClass({
    projectName: variant.projectName,
    files: [variant.composeFile],
    cwd: variant.appDirectory,
    env: composeEnv(variant, resources),
  });
}

export function portsOf(variant: ResolvedVariant): Record<string, number> {
  const ports: Record<string, number> = {};
  for (const service of variant.published) {
    if (service.hostPortEnv && service.hostPort !== undefined) {
      ports[service.hostPortEnv] = service.hostPort;
    }
  }
  return ports;
}

async function waitForHealthy(
  variant: ResolvedVariant,
  timeoutMs: number,
): Promise<Record<string, { status: number; ms: number }>> {
  const deadline = Date.now() + timeoutMs;
  const report: Record<string, { status: number; ms: number }> = {};

  for (const service of variant.published) {
    const url = `http://localhost:${service.hostPort}${service.healthPath}`;
    const startedAt = Date.now();
    let lastError = "not attempted";
    for (;;) {
      try {
        const response = await fetch(url, { redirect: "manual" });
        if (response.ok) {
          // The contract's /healthz returns {"ok":true}; a 200 with ok:false is
          // not healthy. The static SPA's `/` is HTML, so only JSON is checked.
          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const body = (await response.json()) as { ok?: boolean };
            if (body.ok === false)
              throw new Error(`health body says ok:false (${url})`);
          }
          report[service.slot] = {
            status: response.status,
            ms: Date.now() - startedAt,
          };
          break;
        }
        lastError = `HTTP ${response.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `${service.slot} not healthy at ${url} within ${timeoutMs}ms: ${lastError}`,
        );
      }
      await delay(500);
    }
  }
  return report;
}

/** Execute a manifest's seeder command shape against the resolved stack. */
async function runSeeder(
  compose: Compose,
  variant: ResolvedVariant,
  mode: "seed" | "reset" | "verify",
  fixture: FixtureParams | undefined,
  command: string[],
): Promise<SeederReport> {
  const seederService = variant.services.seeder.composeService;
  // Command arrays are a design shape (plan §4); validate shape, don't execute
  // the array literally. Expected: [compose, run, --rm, <seeder>, <mode>].
  if (
    command[0] !== "compose" ||
    command[1] !== "run" ||
    command.at(-1) !== mode
  ) {
    throw new Error(
      `unexpected seeder command shape for '${mode}': ${command.join(" ")}`,
    );
  }

  const env: Record<string, string> =
    mode === "seed" && fixture ? { SEED_FIXTURE: JSON.stringify(fixture) } : {};
  const result = await compose.runService(seederService, [mode], { env });
  const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
  if (!line)
    throw new Error(`seeder ${mode} produced no output: ${result.stderr}`);
  const report = JSON.parse(line) as SeederReport;
  if (mode === "seed" && (!report.digestMatches || !report.rowCountsMatch)) {
    throw new Error(`seeder ${mode} self-check failed: ${line}`);
  }
  return report;
}

/** Run the shared black-box correctness suite against the app-facing port. */
async function runCorrectnessSuite(
  variant: ResolvedVariant,
  options: LifecycleOptions,
): Promise<{ report: string }> {
  const front = variant.services.spa ?? variant.services.app;
  if (!front || front.hostPort === undefined) {
    throw new Error("no published app-facing service to test");
  }
  const report = path.join(
    options.artifacts.dir,
    `variants/${variant.id}/playwright-report.json`,
  );
  const result = await runCommand(
    "pnpm",
    ["exec", "playwright", "test", "--config", "e2e/playwright.config.ts"],
    {
      cwd: options.rigRoot,
      env: {
        BENCH_BASE_URL: `http://localhost:${front.hostPort}`,
        BENCH_REPORT: report,
      },
      allowFailure: true,
      timeoutMs: 10 * 60 * 1000,
    },
  );
  options.artifacts.write(
    `variants/${variant.id}/correctness.log`,
    `${result.stdout}\n${result.stderr}`,
  );
  if (result.code !== 0) {
    throw new Error(
      `correctness suite failed:\n${result.stdout.slice(-4000)}${result.stderr.slice(-1000)}`,
    );
  }
  return { report };
}

/** Run the render-speed collector (plan §6.4) against the app-facing port. */
async function runRenderSuite(
  variant: ResolvedVariant,
  options: LifecycleOptions,
): Promise<{ report: string }> {
  const front = variant.services.spa ?? variant.services.app;
  if (!front || front.hostPort === undefined) {
    throw new Error("no published app-facing service to test");
  }
  const report = path.join(
    options.artifacts.dir,
    `variants/${variant.id}/render.json`,
  );
  const result = await runCommand(
    "pnpm",
    ["exec", "tsx", "src/render/collect.ts"],
    {
      cwd: options.rigRoot,
      env: {
        BENCH_BASE_URL: `http://localhost:${front.hostPort}`,
        BENCH_VARIANT: variant.id,
        BENCH_RENDER_REPORT: report,
        BENCH_WARMUP: String(options.render!.warmup),
        BENCH_MEASURED: String(options.render!.measured),
      },
      allowFailure: true,
      timeoutMs: 20 * 60 * 1000,
    },
  );
  options.artifacts.write(
    `variants/${variant.id}/render.log`,
    `${result.stdout}\n${result.stderr}`,
  );
  if (result.code !== 0) {
    throw new Error(
      `render collector failed:\n${result.stdout.slice(-2000)}${result.stderr.slice(-1000)}`,
    );
  }
  return { report };
}

/** Best-effort pg_stat_statements total-calls snapshot (plan §6.5). */
async function postgresStatements(compose: Compose): Promise<number | null> {
  const result = await compose.exec(
    "db",
    [
      "psql",
      "-U",
      "bench",
      "-d",
      "bench",
      "-tA",
      "-c",
      "CREATE EXTENSION IF NOT EXISTS pg_stat_statements; SELECT COALESCE(sum(calls), 0)::bigint FROM pg_stat_statements",
    ],
    { allowFailure: true },
  );
  if (result.code !== 0) return null;
  const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
  const value = Number(line);
  return Number.isFinite(value) ? value : null;
}

export interface LoadReport {
  target: string;
  baseUrl: string;
  vus: number;
  durationSeconds: number;
  requests: number | null;
  opsPerSecond: number | null;
  p95Ms: number | null;
  failedRate: number | null;
  generatorMaxCpuPercentObserved: number | null;
  generatorMaxCpuPercentLimit: number;
  generatorSaturated: boolean;
  /** Per-path read latency (plan K1), keyed by the tagged path. */
  paths: Record<string, { p50Ms: number | null; p95Ms: number | null }>;
  /** Recorded threshold labels (plan K2); never a gate. */
  thresholds: ThresholdResult[];
  /** The app/db containers' own CPU/RAM during the leg (plan §3.3). */
  resources: ResourceSummary | null;
  pgStatements: {
    before: number | null;
    after: number | null;
    delta: number | null;
  };
}

// --- k6 summary helpers (plan K1/K2) ----------------------------------------
//
// The k6 scripts write a *flat* summary (see `load/summary.js`): the values map
// is spread to the top level and a `thresholds` array is attached, so the
// controller/viewer readers keep working and threshold results are carried.

interface K6SummaryFile {
  metrics?: Record<string, Record<string, unknown>>;
  thresholds?: ThresholdResult[];
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function summaryMetric(
  summary: K6SummaryFile,
  name: string,
  key: string,
): number | null {
  const value = summary.metrics?.[name]?.[key];
  return typeof value === "number" ? value : null;
}

function summaryThresholds(summary: K6SummaryFile): ThresholdResult[] {
  const raw = summary.thresholds;
  if (!Array.isArray(raw)) return [];
  const out: ThresholdResult[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry.metric === "string" &&
      typeof entry.expression === "string" &&
      typeof entry.ok === "boolean"
    ) {
      out.push({
        metric: entry.metric,
        expression: entry.expression,
        ok: entry.ok,
      });
    }
  }
  return out;
}

/** Per-path latency from `http_req_duration{path:…}` sub-metric entries (K1). */
function perPathLatency(
  summary: K6SummaryFile,
): Record<string, { p50Ms: number | null; p95Ms: number | null }> {
  const paths: Record<string, { p50Ms: number | null; p95Ms: number | null }> =
    {};
  for (const [name, entry] of Object.entries(summary.metrics ?? {})) {
    const match = /^http_req_duration\{path:(.+)\}$/.exec(name);
    if (!match) continue;
    paths[match[1]!] = {
      p50Ms: typeof entry.med === "number" ? entry.med : null,
      p95Ms: typeof entry["p(95)"] === "number" ? entry["p(95)"] : null,
    };
  }
  return paths;
}

/**
 * k6 exits non-zero when a threshold fails (code 99). That is a recorded signal,
 * not a stage error (plan K2). Any *other* non-zero exit is fatal.
 */
function k6ExitFatal(exitCode: number, thresholds: ThresholdResult[]): boolean {
  if (exitCode === 0) return false;
  if (exitCode === K6_THRESHOLD_EXIT) return false;
  return !thresholds.some((threshold) => !threshold.ok);
}

// --- Container resource sampling (container-resource-usage-tracking plan) ----
//
// The sampler starts just before the k6 container is created and stops after it
// exits, so the series covers exactly the leg. It samples the stack's own
// services (app/api/spa/db) plus the `bench-k6-*` generator — the generator's CPU
// is derived from this same pass (a consolidation, not a behaviour change).
// Best-effort: a sampling failure is recorded as `resources: null`, never fatal.

async function startLegSampler(
  compose: Compose,
  options: LifecycleOptions,
  variant: ResolvedVariant,
): Promise<ResourceSampler | null> {
  return startResourceSampler({
    compose,
    caps: options.resources,
    generatorName: `bench-k6-${variant.id}`,
  });
}

/** Write the raw 1 Hz series, gated on `report.keepRawSamples` (plan §3.3). */
function writeResourceSeries(
  options: LifecycleOptions,
  variant: ResolvedVariant,
  relative: string,
  capture: SamplerCapture | null,
): void {
  if (!options.keepRawSamples || !capture) return;
  options.artifacts.writeJson(
    `variants/${variant.id}/resources/${relative}`,
    resourceSeriesFile(capture),
  );
}

/**
 * Read-only load via `grafana/k6` on the stack network (plan §6.5/§8.2),
 * targeting the published host port through `host.docker.internal`. Monitors the
 * generator's CPU against `generatorMaxCpuPercent` — a saturated generator is
 * recorded, not silently trusted (plan §6.5).
 */
async function runLoadSuite(
  variant: ResolvedVariant,
  compose: Compose,
  options: LifecycleOptions,
): Promise<LoadReport> {
  const target = variant.load!;
  const service =
    target.service === "app"
      ? variant.services.app
      : target.service === "api"
        ? variant.services.api
        : variant.services.spa;
  if (!service || service.hostPort === undefined) {
    throw new Error(`no published '${target.service}' service to load`);
  }

  const outDir = path.join(options.artifacts.dir, "variants", variant.id);
  const network = `${variant.projectName}_default`;
  const baseUrl = `http://host.docker.internal:${service.hostPort}`;
  const { vus, durationSeconds, generatorMaxCpuPercent } = options.load!;

  const before = await postgresStatements(compose);
  const sampler = await startLegSampler(compose, options, variant);
  const run = await runK6Container({
    containerName: `bench-k6-${variant.id}`,
    network,
    outDir,
    rigRoot: options.rigRoot,
    script: "/load/read.js",
    summaryFile: "k6-summary.json",
    env: {
      BASE_URL: baseUrl,
      PATHS: target.paths.join(","),
      VUS: String(vus),
      DURATION: `${durationSeconds}s`,
    },
  });
  const capture = await stopResourceSampler(sampler);
  options.artifacts.write(`variants/${variant.id}/k6.log`, run.logs);
  writeResourceSeries(options, variant, "read-samples.json", capture);

  const summary =
    readJsonFile<K6SummaryFile>(path.join(outDir, "k6-summary.json")) ?? {};
  const thresholds = summaryThresholds(summary);
  if (k6ExitFatal(run.exitCode, thresholds))
    throw new Error(`k6 exited ${run.exitCode}; see k6.log`);

  const after = await postgresStatements(compose);

  const generatorPercent = generatorCpuPercent(capture);
  const report: LoadReport = {
    target: target.service,
    baseUrl,
    vus,
    durationSeconds,
    requests: summaryMetric(summary, "http_reqs", "count"),
    opsPerSecond: summaryMetric(summary, "http_reqs", "rate"),
    p95Ms: summaryMetric(summary, "http_req_duration", "p(95)"),
    failedRate:
      summaryMetric(summary, "http_req_failed", "rate") ??
      summaryMetric(summary, "http_req_failed", "value"),
    generatorMaxCpuPercentObserved: generatorPercent,
    generatorMaxCpuPercentLimit: generatorMaxCpuPercent,
    generatorSaturated:
      generatorPercent !== null && generatorPercent > generatorMaxCpuPercent,
    paths: perPathLatency(summary),
    thresholds,
    resources: capture?.summary ?? null,
    pgStatements: {
      before,
      after,
      delta: before !== null && after !== null ? after - before : null,
    },
  };
  options.artifacts.writeJson(`variants/${variant.id}/load.json`, report);
  return report;
}

/** Run the pinned k6 image detached on the stack network; wait for it to exit. */
async function runK6Container(options: {
  containerName: string;
  network: string;
  outDir: string;
  rigRoot: string;
  script: string;
  summaryFile: string;
  env: Record<string, string>;
}): Promise<{ exitCode: number; logs: string }> {
  await runCommand("docker", ["rm", "-f", options.containerName], {
    allowFailure: true,
  });
  const args = [
    "run",
    "-d",
    "--name",
    options.containerName,
    "--network",
    options.network,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-v",
    `${path.join(options.rigRoot, "load")}:/load:ro`,
    "-v",
    `${options.outDir}:/out`,
  ];
  for (const [key, value] of Object.entries(options.env))
    args.push("-e", `${key}=${value}`);
  // The scripts write their summary via `handleSummary` to this path (plan K2):
  // the legacy `--summary-export` shape cannot carry threshold results.
  args.push(
    "-e",
    `SUMMARY_FILE=/out/${options.summaryFile}`,
    "grafana/k6:latest",
    "run",
    options.script,
  );

  const started = await runCommand("docker", args, { allowFailure: true });
  if (started.code !== 0) {
    throw new Error(
      `k6 container failed to start: ${started.stderr || started.stdout}`,
    );
  }

  // The generator's CPU/RAM — and the app/db containers' — are sampled by the
  // resource sampler around this call; this loop only waits for k6 to exit.
  for (;;) {
    const running = await runCommand(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", options.containerName],
      { allowFailure: true },
    );
    if (running.stdout.trim() !== "true") break;
    await delay(1000);
  }

  const waited = await runCommand("docker", ["wait", options.containerName], {
    allowFailure: true,
  });
  const exitCode = Number(waited.stdout.trim());
  const logs = await runCommand("docker", ["logs", options.containerName], {
    allowFailure: true,
  });
  await runCommand("docker", ["rm", "-f", options.containerName], {
    allowFailure: true,
  });
  return { exitCode, logs: `${logs.stdout}${logs.stderr}` };
}

interface CaptureFile {
  ops: Record<
    string,
    { op: string; method: string; origin: string; path: string }
  >;
}

interface MutationReport {
  mutationOrigin: string;
  counts: {
    list: number;
    detail: number;
    create: number;
    update: number;
    delete: number;
  };
  achieved: Record<string, number | null>;
  perOpP95Ms: Record<string, number | null>;
  postconditions: {
    createdTasks: number | null;
    updatedOk: number | null;
    deletedRemaining: number | null;
    ok: boolean;
  };
  generatorMaxCpuPercentObserved: number | null;
  generatorSaturated: boolean;
  /** Recorded threshold labels (plan K2); never a gate. */
  thresholds: ThresholdResult[];
  /** The app/db containers' own CPU/RAM during the leg (plan §3.3). */
  resources: ResourceSummary | null;
  pgStatements: {
    before: number | null;
    after: number | null;
    delta: number | null;
  };
}

/**
 * Mutation load (plan §6.5/§5). Captures the app's real write requests
 * (`capture.ts`), replays them via k6 with leased pool ids, and verifies the DB
 * postconditions. This is the per-transport adapter, validated end-to-end.
 */
async function runMutationSuite(
  variant: ResolvedVariant,
  compose: Compose,
  options: LifecycleOptions,
): Promise<MutationReport> {
  const front = variant.services.spa ?? variant.services.app;
  if (!front || front.hostPort === undefined)
    throw new Error("no app-facing service to capture");
  const mutations = options.load!.mutations!;
  const outDir = path.join(options.artifacts.dir, "variants", variant.id);
  const network = `${variant.projectName}_default`;

  // 1. Capture the real write requests.
  const capturePath = path.join(outDir, "capture.json");
  const captureRun = await runCommand(
    "pnpm",
    ["exec", "tsx", "src/load/capture.ts"],
    {
      cwd: options.rigRoot,
      env: {
        BENCH_BASE_URL: `http://localhost:${front.hostPort}`,
        BENCH_VARIANT: variant.id,
        BENCH_CAPTURE_REPORT: capturePath,
      },
      allowFailure: true,
      timeoutMs: 5 * 60 * 1000,
    },
  );
  options.artifacts.write(
    `variants/${variant.id}/capture.log`,
    `${captureRun.stdout}\n${captureRun.stderr}`,
  );
  if (captureRun.code !== 0)
    throw new Error(`capture failed:\n${captureRun.stderr.slice(-2000)}`);
  const capture = JSON.parse(readFileSync(capturePath, "utf8")) as CaptureFile;
  const mutationOrigin = capture.ops.create!.origin;
  const mutationPort = new URL(mutationOrigin).port;

  const before = await postgresStatements(compose);

  // 2. Replay as a volume scenario.
  const env: Record<string, string> = {
    BASE_URL: `http://host.docker.internal:${mutationPort}`,
    CAPTURE: JSON.stringify(capture),
    CONCURRENCY: String(options.load!.vus),
    MAX_DURATION: "10m",
    COUNT_LIST: String(mutations.counts.list),
    COUNT_DETAIL: String(mutations.counts.detail),
    COUNT_CREATE: String(mutations.counts.create),
    COUNT_UPDATE: String(mutations.counts.update),
    COUNT_DELETE: String(mutations.counts.delete),
    UPDATE_FROM: String(mutations.pools.updateFrom),
    UPDATE_TO: String(mutations.pools.updateTo),
    DELETE_FROM: String(mutations.pools.deleteFrom),
    DELETE_TO: String(mutations.pools.deleteTo),
    READ_PATHS: mutations.readPaths.join(","),
  };
  const sampler = await startLegSampler(compose, options, variant);
  const run = await runK6Container({
    containerName: `bench-k6-${variant.id}`,
    network,
    outDir,
    rigRoot: options.rigRoot,
    script: "/load/mutations.js",
    summaryFile: "mutations-summary.json",
    env,
  });
  const legCapture = await stopResourceSampler(sampler);
  options.artifacts.write(`variants/${variant.id}/mutations.log`, run.logs);
  writeResourceSeries(options, variant, "mutations-samples.json", legCapture);

  const after = await postgresStatements(compose);

  const summary =
    readJsonFile<K6SummaryFile>(path.join(outDir, "mutations-summary.json")) ??
    {};
  const thresholds = summaryThresholds(summary);
  if (k6ExitFatal(run.exitCode, thresholds))
    throw new Error(`k6 mutations exited ${run.exitCode}; see mutations.log`);

  // 3. Verify DB postconditions (plan §4/§6.5).
  const leased = (from: number, to: number, count: number): number[] => {
    const span = to - from + 1;
    return Array.from({ length: count }, (_, i) => from + (i % span));
  };
  const inList = (ids: number[]): string =>
    ids.length ? `ARRAY[${ids.join(",")}]::bigint[]` : "ARRAY[]::bigint[]";
  const psqlCount = async (sql: string): Promise<number | null> => {
    const result = await compose.exec(
      "db",
      ["psql", "-U", "bench", "-d", "bench", "-tA", "-c", sql],
      {
        allowFailure: true,
      },
    );
    if (result.code !== 0) return null;
    const value = Number(
      result.stdout.trim().split("\n").filter(Boolean).at(-1),
    );
    return Number.isFinite(value) ? value : null;
  };
  const updIds = leased(
    mutations.pools.updateFrom,
    mutations.pools.updateTo,
    mutations.counts.update,
  );
  const delIds = leased(
    mutations.pools.deleteFrom,
    mutations.pools.deleteTo,
    mutations.counts.delete,
  );
  const createdTasks = await psqlCount(
    "SELECT count(*) FROM tasks WHERE title LIKE 'bench-load-create-%'",
  );
  const updatedOk = await psqlCount(
    `SELECT count(*) FROM tasks WHERE id = ANY(${inList(updIds)}) AND title LIKE 'bench-load-update-%'`,
  );
  const deletedRemaining = await psqlCount(
    `SELECT count(*) FROM tasks WHERE id = ANY(${inList(delIds)})`,
  );

  const achieved = {
    list: summaryMetric(summary, "http_reqs", "count"),
    create: summaryMetric(summary, "mk_create_ok", "count"),
    update: summaryMetric(summary, "mk_update_ok", "count"),
    delete: summaryMetric(summary, "mk_delete_ok", "count"),
    atomic: summaryMetric(summary, "mk_atomic_ok", "count"),
  };

  const postconditions = {
    createdTasks,
    updatedOk,
    deletedRemaining,
    ok:
      (createdTasks ?? 0) >= mutations.counts.create &&
      (updatedOk ?? -1) === mutations.counts.update &&
      deletedRemaining === 0,
  };

  const generatorPercent = generatorCpuPercent(legCapture);
  const report: MutationReport = {
    mutationOrigin,
    counts: mutations.counts,
    achieved,
    perOpP95Ms: {
      create:
        summaryMetric(summary, "http_req_duration{op:create}", "p(95)") ??
        summaryMetric(summary, "http_req_duration", "p(95)"),
    },
    postconditions,
    generatorMaxCpuPercentObserved: generatorPercent,
    generatorSaturated:
      generatorPercent !== null &&
      generatorPercent > options.load!.generatorMaxCpuPercent,
    thresholds,
    resources: legCapture?.summary ?? null,
    pgStatements: {
      before,
      after,
      delta: before !== null && after !== null ? after - before : null,
    },
  };
  options.artifacts.writeJson(`variants/${variant.id}/mutations.json`, report);
  return report;
}

export interface CapacityStepReport {
  targetRate: number;
  requests: number | null;
  achievedPerSecond: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  failedRate: number | null;
  droppedIterations: number | null;
  vusMax: number | null;
  generatorMaxCpuPercentObserved: number | null;
  generatorSaturated: boolean;
  thresholds: ThresholdResult[];
  /** The app/db containers' own CPU/RAM during this step (plan §3.3). */
  resources: ResourceSummary | null;
}

/**
 * Read-weighted mixed capacity ladder (plan K3): one `constant-arrival-rate` run
 * per declared rate. With the generator's CPU under the limit, dropped
 * iterations (or a degraded p95) mark the app's tipping point — the whole point
 * of the instrument. The ladder makes no mutation-*capacity* claim: mutations
 * remain the closed-loop volume measurement.
 */
export interface CapacityReport {
  /** False when the ladder could not run (rendered blank, never zero). */
  applicable: boolean;
  /** True when write ops replayed captured requests; false = read-only fallback. */
  mixed: boolean;
  scenarioId: string;
  durationPerStepSeconds: number;
  ratesPerSecond: number[];
  steps: CapacityStepReport[];
}

async function runCapacitySuite(
  variant: ResolvedVariant,
  compose: Compose,
  options: LifecycleOptions,
): Promise<CapacityReport> {
  const scenario = options.load!.capacity!.scenario;
  const target = variant.load!;
  const service =
    target.service === "app"
      ? variant.services.app
      : target.service === "api"
        ? variant.services.api
        : variant.services.spa;
  if (!service || service.hostPort === undefined) {
    throw new Error(`no published '${target.service}' service for capacity`);
  }

  const outDir = path.join(options.artifacts.dir, "variants", variant.id);
  const network = `${variant.projectName}_default`;
  const baseUrl = `http://host.docker.internal:${service.hostPort}`;
  const log: string[] = [];

  // Reset once before the ladder (plan K3/§8.4): no reset between steps, so the
  // point — sustained pressure across the ladder — is not destroyed.
  if (scenario.resetBefore) {
    await runSeeder(compose, variant, "reset", undefined, variant.resetCommand);
  }

  // Write ops replay the captured requests when the volume leg produced them;
  // otherwise the ladder degrades to reads only (recorded, never hidden).
  const capture = readJsonFile<CaptureFile>(path.join(outDir, "capture.json"));
  const pools = options.load!.mutations?.pools ?? null;
  const mixed = Boolean(capture?.ops?.create && pools);

  const steps: CapacityStepReport[] = [];
  for (const rate of scenario.ratesPerSecond) {
    const sampler = await startLegSampler(compose, options, variant);
    const run = await runK6Container({
      containerName: `bench-k6-${variant.id}`,
      network,
      outDir,
      rigRoot: options.rigRoot,
      script: "/load/capacity.js",
      summaryFile: `capacity-${rate}-summary.json`,
      env: {
        BASE_URL: baseUrl,
        RATE: String(rate),
        DURATION: `${scenario.durationPerStepSeconds}s`,
        PREALLOCATED_VUS: String(scenario.preallocatedVUs),
        MAX_VUS: String(scenario.maxVUs),
        READ_PATHS: target.paths.join(","),
        WEIGHT_LIST: String(scenario.weights.list),
        WEIGHT_DETAIL: String(scenario.weights.detail),
        WEIGHT_CREATE: String(scenario.weights.create),
        WEIGHT_UPDATE: String(scenario.weights.update),
        WEIGHT_DELETE: String(scenario.weights.delete),
        CAPTURE: mixed ? JSON.stringify(capture) : "",
        UPDATE_FROM: String(pools?.updateFrom ?? 1),
        UPDATE_TO: String(pools?.updateTo ?? 1),
        DELETE_FROM: String(pools?.deleteFrom ?? 1),
        DELETE_TO: String(pools?.deleteTo ?? 1),
      },
    });
    const legCapture = await stopResourceSampler(sampler);
    writeResourceSeries(
      options,
      variant,
      `capacity/${rate}-samples.json`,
      legCapture,
    );
    log.push(`=== ${rate}/s ===\n${run.logs}`);

    const summary =
      readJsonFile<K6SummaryFile>(
        path.join(outDir, `capacity-${rate}-summary.json`),
      ) ?? {};
    const thresholds = summaryThresholds(summary);
    const generatorPercent = generatorCpuPercent(legCapture);
    const step: CapacityStepReport = {
      targetRate: rate,
      requests: summaryMetric(summary, "http_reqs", "count"),
      achievedPerSecond: summaryMetric(summary, "http_reqs", "rate"),
      p95Ms: summaryMetric(summary, "http_req_duration", "p(95)"),
      p99Ms: summaryMetric(summary, "http_req_duration", "p(99)"),
      failedRate:
        summaryMetric(summary, "http_req_failed", "rate") ??
        summaryMetric(summary, "http_req_failed", "value"),
      droppedIterations: summaryMetric(summary, "dropped_iterations", "count"),
      vusMax:
        summaryMetric(summary, "vus_max", "value") ??
        summaryMetric(summary, "vus_max", "max"),
      generatorMaxCpuPercentObserved: generatorPercent,
      generatorSaturated:
        generatorPercent !== null &&
        generatorPercent > options.load!.generatorMaxCpuPercent,
      thresholds,
      resources: legCapture?.summary ?? null,
    };
    options.artifacts.writeJson(
      `variants/${variant.id}/capacity/${rate}.json`,
      step,
    );
    steps.push(step);

    if (k6ExitFatal(run.exitCode, thresholds)) {
      options.artifacts.write(
        `variants/${variant.id}/capacity.log`,
        log.join("\n"),
      );
      throw new Error(
        `k6 capacity @ ${rate}/s exited ${run.exitCode}; see capacity.log`,
      );
    }
  }
  options.artifacts.write(
    `variants/${variant.id}/capacity.log`,
    log.join("\n"),
  );

  const report: CapacityReport = {
    applicable: true,
    mixed,
    scenarioId: scenario.id,
    durationPerStepSeconds: scenario.durationPerStepSeconds,
    ratesPerSecond: [...scenario.ratesPerSecond],
    steps,
  };
  options.artifacts.writeJson(`variants/${variant.id}/capacity.json`, report);
  return report;
}

async function buildStack(
  variant: ResolvedVariant,
  compose: Compose,
  options: LifecycleOptions,
): Promise<unknown> {
  if (options.buildSeeder) {
    await runCommand(
      "docker",
      ["build", "-t", SEEDER_IMAGE, path.join(options.rigRoot, "seeder")],
      {
        timeoutMs: 30 * 60 * 1000,
      },
    );
  }

  const noCache = options.build !== false && options.build?.noCache;
  const built = await compose.build({ noCache });
  const images = await compose.images();
  return { buildMs: built.durationMs, imagesJson: images.stdout.trim() };
}

export async function runVariant(
  variant: ResolvedVariant,
  options: LifecycleOptions,
): Promise<VariantResult> {
  const compose = composeFor(variant, options.resources);
  const stages: Record<string, StageRecord> = {};
  const ports = portsOf(variant);
  const base = { id: variant.id, cohort: variant.cohort, ports };

  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      const detail = await fn();
      stages[name] = { ok: true, ms: Date.now() - startedAt, detail };
      return detail;
    } catch (err) {
      stages[name] = {
        ok: false,
        ms: Date.now() - startedAt,
        detail: err instanceof Error ? err.message : String(err),
      };
      throw err;
    }
  };

  let result: VariantResult;
  try {
    if (options.build !== false) {
      await stage("build", () => buildStack(variant, compose, options));
    }
    await stage("up", () => compose.up());
    await stage("ready", () =>
      waitForHealthy(variant, options.readinessTimeoutMs ?? 90_000),
    );
    await stage("reset", () =>
      runSeeder(compose, variant, "reset", undefined, variant.resetCommand),
    );
    const seed = await stage("seed", () =>
      runSeeder(compose, variant, "seed", options.fixture, variant.seedCommand),
    );
    const schema = await stage("verifySchema", () => verifySchema(compose));
    const digest = await stage("verifyDigest", () =>
      verifyDigest(compose, (seed as SeederReport).combinedSha256),
    );
    if (options.correctness) {
      await stage("correctness", () => runCorrectnessSuite(variant, options));
    }
    if (options.render) {
      // Render is a measurement, not a gate: a failure is recorded but does not
      // invalidate the variant's correctness/perf eligibility.
      const startedAt = Date.now();
      try {
        const detail = await runRenderSuite(variant, options);
        stages.render = { ok: true, ms: Date.now() - startedAt, detail };
      } catch (err) {
        stages.render = {
          ok: false,
          ms: Date.now() - startedAt,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }
    if (options.load && variant.load) {
      const startedAt = Date.now();
      try {
        const read = await runLoadSuite(variant, compose, options);
        const mutations = options.load.mutations
          ? await runMutationSuite(variant, compose, options)
          : null;
        // The capacity ladder runs last: it reuses the mutation leg's captured
        // requests for its write ops (plan K3).
        const capacity = options.load.capacity
          ? await runCapacitySuite(variant, compose, options)
          : null;
        stages.load = {
          ok: true,
          ms: Date.now() - startedAt,
          detail: { ...read, mutations, capacity },
        };
      } catch (err) {
        stages.load = {
          ok: false,
          ms: Date.now() - startedAt,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const eligible = schema.ok && (digest.matches ?? false);
    result = {
      ...base,
      status: eligible ? "ok" : "failed",
      performanceEligible: eligible,
      stages,
      ...(eligible ? {} : { error: "schema/digest verification failed" }),
    };
  } catch (err) {
    result = {
      ...base,
      status: "failed",
      performanceEligible: false,
      stages,
      error: err instanceof Error ? err.message : String(err),
    };
    const logs = await compose.logs();
    options.artifacts.write(
      `variants/${variant.id}/failure.log`,
      `${logs.stdout}${logs.stderr}`,
    );
  } finally {
    const startedAt = Date.now();
    const down = await compose.down({ volumes: true, removeOrphans: true });
    stages.teardown = { ok: down.code === 0, ms: Date.now() - startedAt };
    result ??= {
      ...base,
      status: "failed",
      performanceEligible: false,
      stages,
      error: "aborted",
    };
    result.stages = stages;
    options.artifacts.writeJson(
      `variants/${variant.id}/lifecycle.json`,
      result,
    );
  }

  return result;
}
