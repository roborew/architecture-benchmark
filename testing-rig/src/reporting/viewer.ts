// Results viewer (plan §3/§4). A run *index* built from `results/` on disk plus a
// single self-contained HTML page. It is a reproducible view over the raw run
// artefacts — never a second copy of the data (same principle as `pnpm report`).
//
// Two house rules (docs/live.md, src/reporting/README.md) apply:
//   1. No composite "best" column or score — per-metric leaders only.
//   2. Blank means not measured, never zero.
//
// Everything here is synchronous and Docker-free so it can be unit-tested and so
// the controller can refresh the page at the end of every run without ceremony.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { VariantManifest } from "../config/schema.js";
import type { DependencyManifest, StaticInventory } from "./inventory.js";
import { percentile } from "./matrix.js";

// ---------------------------------------------------------------------------
// Public data shape (plan §3.1)

export interface Bucket {
  files: number;
  loc: number;
  bytes: number;
}

export interface VariantInventoryView {
  source: Bucket;
  tests: Bucket;
  infrastructure: Bucket;
  /** Authored totals — the sum of the three buckets above. */
  totals: Bucket;
  /** On-disk footprint (V3): whole-directory `du`, no exclusions. */
  footprint: { files: number; bytes: number } | null;
  /** Per-manifest breakdown (D3) — shown in the deps cell's tooltip. */
  dependencyManifests: DependencyManifest[];
  directDependencies: number;
  languages: number;
  serviceCount: number;
  imageCount: number;
}

export interface VariantRenderView {
  /** p50 reductions only — the raw sample arrays are never embedded. */
  pages: Record<
    string,
    {
      ttfb: number | null;
      fcp: number | null;
      lcp: number | null;
      firstData: number | null;
    }
  >;
  interactions: Record<string, number | null>;
}

export interface VariantLoadView {
  vus: number;
  requests: number;
  /** Null when the generator saturated (the number is withheld, not shown). */
  opsPerSecond: number | null;
  p95Ms: number | null;
  failedRate: number;
  generatorSaturated: boolean;
  pgStatementsDelta: number | null;
  /** Labelled threshold results (K2) — never gates, only recorded labels. */
  thresholds: ThresholdResult[];
  /** Per-path read latency (K1), keyed by path. */
  paths: Record<string, { p50Ms: number | null; p95Ms: number | null }>;
  /** The app/db containers' own CPU/RAM during the leg (container-resource plan). */
  resources: VariantResourceView | null;
}

export interface ThresholdResult {
  metric: string;
  expression: string;
  ok: boolean;
}

/** Per-service folded container-resource usage (container-resource plan §3.3). */
export interface VariantResourceUsageView {
  maxCpuPctOfEnv: number | null;
  avgCpuPctOfEnv: number | null;
  maxMemMb: number | null;
  maxMemPctOfEnv: number | null;
}

export interface VariantResourceView {
  /** `api` (Engine API, raw counters) or `cli` (ambiguous normalization). */
  source: string;
  services: Record<string, VariantResourceUsageView>;
  oomKills: number | null;
}

/** A downsampled CPU%/RAM% timeline for one load leg (never the raw series). */
export interface ResourceSeriesView {
  label: string;
  points: Array<{ t: number; cpu: number | null; mem: number | null }>;
}

/** One capacity-ladder step (K3). */
export interface CapacityStepView {
  targetRate: number;
  achievedPerSecond: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  failedRate: number | null;
  droppedIterations: number | null;
  vusMax: number | null;
  generatorSaturated: boolean;
  thresholds: ThresholdResult[];
  /** The app/db containers' own CPU/RAM during this step (plan §3.3). */
  resources: VariantResourceView | null;
}

/** The read-weighted mixed capacity ladder for one variant (K3). */
export interface VariantCapacityView {
  /** False when the ladder could not run for this variant (blank, not zero). */
  applicable: boolean;
  /** True when write ops replayed captured requests; false = read-only. */
  mixed: boolean;
  scenarioId: string;
  steps: CapacityStepView[];
}

export interface VariantMutationView {
  perOp: Record<"create" | "update" | "delete", { count: number; rate: number } | null>;
  duration: {
    avg: number;
    med: number;
    p90: number;
    p95: number;
    p99: number;
    max: number;
  } | null;
  failures: number | null;
  /** Recorded threshold labels (K2) — never a gate. */
  thresholds: ThresholdResult[];
  /** The app/db containers' own CPU/RAM during the leg (plan §3.3). */
  resources: VariantResourceView | null;
}

export interface VariantView {
  id: string;
  cohort: string;
  orm: string;
  readMode: string;
  mutationMode: string;
  status: string;
  performanceEligible: boolean;
  error: string | null;
  stages: Record<string, { ok: boolean; ms: number } | null>;
  inventory: VariantInventoryView | null;
  render: VariantRenderView | null;
  load: VariantLoadView | null;
  mutations: VariantMutationView | null;
  capacity: VariantCapacityView | null;
  correctness: "pass" | "fail" | null;
  /** The loaded service slot (app | api | spa) — the front for resource views. */
  loadService: string;
  /** Downsampled CPU%/RAM% timelines, one per leg that recorded raw samples. */
  resourceSeries: ResourceSeriesView[];
}

export interface RunView {
  runId: string;
  /** No summary.json, or a summary that recorded zero variants. */
  incomplete: boolean;
  configName: string | null;
  configFile: string | null;
  gitRevision: string | null;
  effectiveManifestSha256: string | null;
  startedAt: string | null;
  okCount: number;
  totalCount: number;
  /** The effective-config.yaml, parsed as-is (the "inputs of the run"). */
  inputs: Record<string, unknown> | null;
  /**
   * Effective stage selection from `preflight.json` (plan D1/D2). Null for runs
   * whose preflight predates D1 — the viewer then never guesses "not requested".
   */
  requestedStages: {
    correctness: boolean;
    render: boolean;
    load: boolean;
  } | null;
  /** The `--only` filter, if any (explains a partial run). */
  only: string[] | null;
  variants: VariantView[];
}

// ---------------------------------------------------------------------------
// Raw artefact shapes (trimmed locally — never re-exported raw)

interface PreflightFile {
  runId?: string;
  gitRevision?: string;
  config?: string;
  effectiveManifestSha256?: string;
  /** Effective stage selection (plan D1). Absent in pre-D1 runs. */
  stages?: { correctness?: boolean; render?: boolean; load?: boolean };
  only?: string[] | null;
}

interface SummaryResult {
  id: string;
  cohort: string;
  status: string;
  performanceEligible: boolean;
  stages?: Record<string, { ok: boolean; ms: number }>;
  error?: string | null;
}

interface SummaryFile {
  runId?: string;
  effectiveManifestSha256?: string;
  results?: SummaryResult[];
}

interface RenderFile {
  pages?: Record<string, Array<{ ttfb: number; fcp: number; lcp: number; firstData: number }>>;
  interactions?: Record<string, number[]>;
}

interface LoadFile {
  vus?: number;
  requests?: number | null;
  opsPerSecond?: number | null;
  p95Ms?: number | null;
  failedRate?: number | null;
  generatorSaturated?: boolean;
  pgStatements?: { before?: number; after?: number; delta?: number };
  /** Per-path read latency (K1), keyed by path. */
  paths?: Record<string, { p50Ms?: number | null; p95Ms?: number | null }>;
  /** Recorded threshold labels (K2) — never a gate. */
  thresholds?: ThresholdResult[];
  /** Folded container-resource aggregate (container-resource plan §3.3). */
  resources?: ResourceSummaryFile | null;
}

/** The folded per-leg resource aggregate, as written by the controller. */
interface ResourceUsageFile {
  maxCpuPctOfEnv?: number | null;
  avgCpuPctOfEnv?: number | null;
  maxMemMb?: number | null;
  maxMemPctOfEnv?: number | null;
}
interface ResourceSummaryFile {
  source?: string;
  services?: Record<string, ResourceUsageFile>;
  oomKills?: number | null;
}

/** The raw 1 Hz series in `resources/*-samples.json` (only reduced, never kept). */
interface ResourceSampleFile {
  t?: number;
  service?: string;
  cores?: number | null;
  cpuPctOfEnv?: number | null;
  memWorkingSetMb?: number | null;
  memPctOfEnv?: number | null;
}
interface ResourceSeriesFile {
  source?: string;
  intervalMs?: number;
  samples?: ResourceSampleFile[];
}

/** The controller's `variants/<id>/mutations.json` — read only for resources. */
interface MutationReportFile {
  resources?: ResourceSummaryFile | null;
}

interface CapacityStepFile {
  targetRate?: number;
  achievedPerSecond?: number | null;
  p95Ms?: number | null;
  p99Ms?: number | null;
  failedRate?: number | null;
  droppedIterations?: number | null;
  vusMax?: number | null;
  generatorSaturated?: boolean;
  thresholds?: ThresholdResult[];
  resources?: ResourceSummaryFile | null;
}

interface CapacityFile {
  applicable?: boolean;
  mixed?: boolean;
  scenarioId?: string;
  steps?: CapacityStepFile[];
}

interface K6Metric {
  count?: number;
  rate?: number;
  value?: number;
  avg?: number;
  med?: number;
  min?: number;
  max?: number;
  fails?: number;
  passes?: number;
  "p(90)"?: number;
  "p(95)"?: number;
  "p(99)"?: number;
  /** New (handleSummary) shape: `{ [metric]: { values, thresholds } }`. */
  values?: Record<string, number>;
  thresholds?: Record<string, { ok?: boolean }>;
}

interface MutationsSummaryFile {
  metrics?: Record<string, K6Metric>;
}

// ---------------------------------------------------------------------------
// Small IO helpers — a missing artefact is `null`, never an exception.

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function readYaml(file: string): Record<string, unknown> | null {
  try {
    const parsed = YAML.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `2026-10-09t17-44-06-935z` → `2026-10-09T17:44:06.935Z`. */
export function parseRunId(runId: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[tT](\d{2})-(\d{2})-(\d{2})-(\d{3})[zZ]$/.exec(runId);
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

const p50 = (values: number[] | undefined): number | null =>
  values && values.length > 0 ? percentile(values, 50) : null;

const positive = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Sort + sanitise recorded threshold labels (K2) so they render deterministically. */
function normaliseThresholds(raw: ThresholdResult[] | undefined): ThresholdResult[] {
  if (!Array.isArray(raw)) return [];
  const out: ThresholdResult[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    out.push({
      metric: String(entry.metric ?? ""),
      expression: String(entry.expression ?? ""),
      ok: entry.ok === true,
    });
  }
  out.sort((a, b) =>
    a.metric === b.metric
      ? a.expression < b.expression
        ? -1
        : a.expression > b.expression
          ? 1
          : 0
      : a.metric < b.metric
        ? -1
        : 1,
  );
  return out;
}

/** Lift per-metric threshold results out of a raw k6 (handleSummary) metrics map. */
function thresholdsFromK6(metrics: Record<string, K6Metric> | undefined): ThresholdResult[] {
  const out: ThresholdResult[] = [];
  for (const [metric, definition] of Object.entries(metrics ?? {})) {
    for (const [expression, result] of Object.entries(definition.thresholds ?? {}))
      out.push({ metric, expression, ok: result?.ok === true });
  }
  return normaliseThresholds(out);
}

/** Read a k6 metric value from either the new (`values`) or legacy (flat) shape. */
function k6Value(metric: K6Metric | undefined, key: string): number | undefined {
  const value = metric?.values?.[key] ?? metric?.[key as keyof K6Metric];
  return typeof value === "number" ? value : undefined;
}

function reduceRender(report: RenderFile | null): VariantRenderView | null {
  if (!report) return null;
  const pages: VariantRenderView["pages"] = {};
  for (const [name, samples] of Object.entries(report.pages ?? {})) {
    if (!Array.isArray(samples)) continue;
    pages[name] = {
      ttfb: p50(samples.map((s) => s.ttfb)),
      // FCP/LCP read as -1 when the engine did not report the paint entry; those
      // are blank, never a zero (plan §4.3, src/render/README.md).
      fcp: p50(samples.map((s) => s.fcp).filter((v) => v >= 0)),
      lcp: p50(samples.map((s) => s.lcp).filter((v) => v >= 0)),
      firstData: p50(samples.map((s) => s.firstData)),
    };
  }
  const interactions: Record<string, number | null> = {};
  for (const [name, values] of Object.entries(report.interactions ?? {})) {
    interactions[name] = Array.isArray(values) ? percentile(values, 50) : null;
  }
  return { pages, interactions };
}

function reduceLoad(report: LoadFile | null): VariantLoadView | null {
  if (!report) return null;
  const generatorSaturated = report.generatorSaturated === true;
  const paths: Record<string, { p50Ms: number | null; p95Ms: number | null }> = {};
  for (const [path, values] of Object.entries(report.paths ?? {})) {
    paths[path] = {
      p50Ms: positive(values.p50Ms ?? null),
      p95Ms: positive(values.p95Ms ?? null),
    };
  }
  return {
    vus: report.vus ?? 0,
    requests: report.requests ?? 0,
    // A generator-saturated trial is an invalid app measurement: withhold the
    // numbers (keep the flag so the UI can say why) — plan §2/§4.3/§6.5.
    opsPerSecond: generatorSaturated ? null : positive(report.opsPerSecond ?? null),
    p95Ms: generatorSaturated ? null : positive(report.p95Ms ?? null),
    failedRate: report.failedRate ?? 0,
    generatorSaturated,
    pgStatementsDelta: report.pgStatements?.delta ?? null,
    paths,
    thresholds: normaliseThresholds(report.thresholds),
    resources: reduceResources(report.resources),
  };
}

/** Fold a leg's resource aggregate into the viewer shape; blank stays blank. */
function reduceResources(
  summary: ResourceSummaryFile | null | undefined,
): VariantResourceView | null {
  if (!summary || !summary.services || typeof summary.services !== "object") return null;
  const services: Record<string, VariantResourceUsageView> = {};
  for (const [name, usage] of Object.entries(summary.services)) {
    services[name] = {
      maxCpuPctOfEnv: positive(usage?.maxCpuPctOfEnv),
      avgCpuPctOfEnv: positive(usage?.avgCpuPctOfEnv),
      maxMemMb: positive(usage?.maxMemMb),
      maxMemPctOfEnv: positive(usage?.maxMemPctOfEnv),
    };
  }
  return {
    source: typeof summary.source === "string" ? summary.source : "unknown",
    services,
    oomKills: positive(summary.oomKills),
  };
}

/** Cap the embedded per-leg timeline; the raw series is never embedded. */
const MAX_RESOURCE_POINTS = 40;

function reduceResourceSeries(
  file: ResourceSeriesFile | null,
  front: string,
): Array<{ t: number; cpu: number | null; mem: number | null }> | null {
  const samples = file?.samples;
  if (!Array.isArray(samples)) return null;
  const points: Array<{ t: number; cpu: number | null; mem: number | null }> = [];
  for (const sample of samples) {
    if (!sample || sample.service !== front) continue;
    points.push({
      t: positive(sample.t) ?? 0,
      cpu: positive(sample.cpuPctOfEnv),
      mem: positive(sample.memPctOfEnv),
    });
  }
  if (points.length === 0) return null;
  if (points.length <= MAX_RESOURCE_POINTS) return points;
  const step = points.length / MAX_RESOURCE_POINTS;
  const out: typeof points = [];
  for (let i = 0; i < MAX_RESOURCE_POINTS; i += 1) out.push(points[Math.floor(i * step)]!);
  out[out.length - 1] = points[points.length - 1]!;
  return out;
}

function reduceCapacity(report: CapacityFile | null): VariantCapacityView | null {
  if (!report) return null;
  const steps: CapacityStepView[] = (report.steps ?? []).map((step) => ({
    targetRate: step.targetRate ?? 0,
    achievedPerSecond: positive(step.achievedPerSecond ?? null),
    p95Ms: positive(step.p95Ms ?? null),
    p99Ms: positive(step.p99Ms ?? null),
    failedRate: step.failedRate ?? null,
    droppedIterations: step.droppedIterations ?? null,
    vusMax: step.vusMax ?? null,
    generatorSaturated: step.generatorSaturated === true,
    thresholds: normaliseThresholds(step.thresholds),
    resources: reduceResources(step.resources),
  }));
  steps.sort((a, b) => a.targetRate - b.targetRate);
  return {
    applicable: report.applicable !== false,
    mixed: report.mixed === true,
    scenarioId: report.scenarioId ?? "",
    steps,
  };
}

function reduceMutations(
  report: MutationsSummaryFile | null,
  resources: ResourceSummaryFile | null | undefined,
): VariantMutationView | null {
  const metrics = report?.metrics;
  if (!metrics) return null;
  const perOpOf = (
    kind: "create" | "update" | "delete",
  ): { count: number; rate: number } | null => {
    const metric = metrics[`mk_${kind}_ok`];
    const count = k6Value(metric, "count");
    const rate = k6Value(metric, "rate");
    return typeof count === "number" && typeof rate === "number" ? { count, rate } : null;
  };
  const raw = metrics.http_req_duration;
  const duration =
    raw &&
    k6Value(raw, "avg") !== undefined &&
    k6Value(raw, "med") !== undefined &&
    k6Value(raw, "p(90)") !== undefined &&
    k6Value(raw, "p(95)") !== undefined &&
    k6Value(raw, "p(99)") !== undefined &&
    k6Value(raw, "max") !== undefined
      ? {
          avg: k6Value(raw, "avg")!,
          med: k6Value(raw, "med")!,
          p90: k6Value(raw, "p(90)")!,
          p95: k6Value(raw, "p(95)")!,
          p99: k6Value(raw, "p(99)")!,
          max: k6Value(raw, "max")!,
        }
      : null;
  const fails = k6Value(metrics.http_req_failed, "fails");
  return {
    perOp: {
      create: perOpOf("create"),
      update: perOpOf("update"),
      delete: perOpOf("delete"),
    },
    duration,
    failures: typeof fails === "number" ? fails : null,
    thresholds: thresholdsFromK6(metrics),
    resources: reduceResources(resources),
  };
}

function inventoryOf(raw: StaticInventory | undefined): VariantInventoryView | null {
  if (!raw) return null;
  const bucket = (b: StaticInventory["source"]): Bucket => ({
    files: b.files,
    loc: b.loc,
    bytes: b.bytes,
  });
  const source = bucket(raw.source);
  const tests = bucket(raw.tests);
  const infrastructure = bucket(raw.infrastructure);
  return {
    source,
    tests,
    infrastructure,
    totals: {
      files: source.files + tests.files + infrastructure.files,
      loc: source.loc + tests.loc + infrastructure.loc,
      bytes: source.bytes + tests.bytes + infrastructure.bytes,
    },
    // Absent in inventory.json files written before V3.
    footprint: raw.footprint ?? null,
    dependencyManifests: raw.dependencyManifests ?? [],
    directDependencies: raw.directDependencies,
    languages: raw.languages,
    serviceCount: raw.serviceCount,
    imageCount: raw.imageCount,
  };
}

function buildVariant(
  result: SummaryResult,
  runDir: string,
  inventory: Map<string, StaticInventory>,
  manifests: Map<string, VariantManifest>,
): VariantView {
  const manifest = manifests.get(result.id);
  const variantDir = path.join(runDir, "variants", result.id);
  const stages = result.stages ?? {};
  const correctness = stages.correctness;
  const loadService = manifest?.load?.service ?? (result.cohort === "spa-api" ? "api" : "app");
  const capacityReport = readJson<CapacityFile>(path.join(variantDir, "capacity.json"));
  const mutationReport = readJson<MutationReportFile>(path.join(variantDir, "mutations.json"));
  return {
    id: result.id,
    cohort: result.cohort,
    orm: manifest?.orm ?? "—",
    readMode: manifest?.readMode ?? "—",
    mutationMode: manifest?.mutationMode ?? "—",
    status: result.status,
    performanceEligible: result.performanceEligible,
    error: result.error ?? null,
    stages,
    inventory: inventoryOf(inventory.get(result.id)),
    render: reduceRender(readJson<RenderFile>(path.join(variantDir, "render.json"))),
    load: reduceLoad(readJson<LoadFile>(path.join(variantDir, "load.json"))),
    mutations: reduceMutations(
      readJson<MutationsSummaryFile>(path.join(variantDir, "mutations-summary.json")),
      mutationReport?.resources,
    ),
    capacity: reduceCapacity(capacityReport),
    correctness: correctness ? (correctness.ok ? "pass" : "fail") : null,
    loadService,
    resourceSeries: reduceAllResourceSeries(variantDir, loadService, capacityReport),
    // Deliberately never read (beyond the resource aggregate): mutations.json
    // raw samples, capture.json (request bodies), *.log, lifecycle.json stdout.
  };
}

/** Build the downsampled CPU%/RAM% timelines, one per leg with raw samples. */
function reduceAllResourceSeries(
  variantDir: string,
  front: string,
  capacity: CapacityFile | null,
): ResourceSeriesView[] {
  const series: ResourceSeriesView[] = [];
  const readPoints = reduceResourceSeries(
    readJson<ResourceSeriesFile>(path.join(variantDir, "resources", "read-samples.json")),
    front,
  );
  if (readPoints) series.push({ label: "read", points: readPoints });
  for (const step of [...(capacity?.steps ?? [])].sort(
    (a, b) => (a.targetRate ?? 0) - (b.targetRate ?? 0),
  )) {
    if (typeof step.targetRate !== "number") continue;
    const points = reduceResourceSeries(
      readJson<ResourceSeriesFile>(
        path.join(variantDir, "resources", "capacity", `${step.targetRate}-samples.json`),
      ),
      front,
    );
    if (points) series.push({ label: `${step.targetRate}/s`, points });
  }
  const mutationPoints = reduceResourceSeries(
    readJson<ResourceSeriesFile>(path.join(variantDir, "resources", "mutations-samples.json")),
    front,
  );
  if (mutationPoints) series.push({ label: "mutations", points: mutationPoints });
  return series;
}

function readInventory(runDir: string): Map<string, StaticInventory> {
  const raw = readJson<StaticInventory[]>(path.join(runDir, "inventory.json"));
  return new Map((raw ?? []).map((entry) => [entry.variantId, entry]));
}

function buildRun(
  runId: string,
  runDir: string,
  preflight: PreflightFile | null,
  summary: SummaryFile | null,
  effective: Record<string, unknown> | null,
  manifests: Map<string, VariantManifest>,
): RunView {
  const results = summary?.results ?? [];
  const inventory = readInventory(runDir);
  const variants = results.map((result) => buildVariant(result, runDir, inventory, manifests));
  // Stable across runs (cohort, then id) so two runs are easy to eyeball.
  variants.sort((a, b) =>
    a.cohort === b.cohort ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.cohort < b.cohort ? -1 : 1,
  );
  return {
    runId,
    incomplete: !summary || results.length === 0,
    configName: typeof effective?.name === "string" ? effective.name : null,
    configFile: preflight?.config ?? null,
    gitRevision: preflight?.gitRevision ?? null,
    effectiveManifestSha256:
      summary?.effectiveManifestSha256 ?? preflight?.effectiveManifestSha256 ?? null,
    startedAt: parseRunId(runId),
    okCount: results.filter((r) => r.status === "ok").length,
    totalCount: results.length,
    inputs: effective,
    // Null for pre-D1 runs: the viewer must never guess "not requested".
    requestedStages: preflight?.stages
      ? {
          correctness: preflight.stages.correctness === true,
          render: preflight.stages.render === true,
          load: preflight.stages.load === true,
        }
      : null,
    only: preflight?.only ?? null,
    variants,
  };
}

/**
 * Enumerate every run directory under `resultsRoot` and normalise it.
 *
 * A directory is a run if it holds `preflight.json`, `summary.json` or
 * `effective-config.yaml`; anything else (future junk) is ignored. Newest first.
 *
 * `manifests` supplies the static per-variant identity columns (orm/read/mutation
 * mode) — pass the map from `loadManifestDirectory("manifests")` in `cli.ts`, as
 * with `buildMatrix`. A missing manifest renders as "—".
 */
export function buildRunsIndex(
  resultsRoot: string,
  manifests: Map<string, VariantManifest> = new Map(),
): RunView[] {
  if (!existsSync(resultsRoot)) return [];
  let names: string[];
  try {
    names = readdirSync(resultsRoot);
  } catch {
    return [];
  }

  const runs: RunView[] = [];
  for (const name of names) {
    const runDir = path.join(resultsRoot, name);
    try {
      if (!statSync(runDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const preflight = readJson<PreflightFile>(path.join(runDir, "preflight.json"));
    const summary = readJson<SummaryFile>(path.join(runDir, "summary.json"));
    const effective = readYaml(path.join(runDir, "effective-config.yaml"));
    if (!preflight && !summary && !effective) continue; // not a run
    runs.push(buildRun(name, runDir, preflight, summary, effective, manifests));
  }

  // Newest first; run-ids are ISO timestamps (one old run uses uppercase T/Z, so
  // compare case-insensitively).
  runs.sort((a, b) => {
    const left = a.runId.toLowerCase();
    const right = b.runId.toLowerCase();
    return left < right ? 1 : left > right ? -1 : 0;
  });
  return runs;
}

// ---------------------------------------------------------------------------
// Compare view: load levels (plan V-B / R4)
//
// A load level is `configName × resource envelope` — `medium-load @ 2c/2g` and
// `medium-load @ 4c/4g` are *different* levels, never quietly averaged (R4).
// Levels are ordered by an ordinal derived from the inputs (fixture taskCount,
// then total volume counts, then the max capacity rate); the envelope is a
// separate axis and is never folded into the load ordinal.

export interface LoadLevelEnvelope {
  label: string;
  appCpus: number | null;
  appMemoryMb: number | null;
  dbCpus: number | null;
  dbMemoryMb: number | null;
}

export interface LoadLevelOrdinal {
  taskCount: number;
  volume: number;
  maxRate: number;
}

export interface LoadLevel {
  key: string;
  /** Headline, e.g. `medium-load @ 2c/2048MB` (the numbers are the proof). */
  label: string;
  configName: string | null;
  envelope: LoadLevelEnvelope | null;
  ordinal: LoadLevelOrdinal;
  /** Human-readable derivation of the ordinal, shown in the inputs table. */
  ordinalProof: string;
  /** Run ids in this level, newest first; `runIds[0]` is the primary run. */
  runIds: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numeric = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function envelopeOf(inputs: Record<string, unknown> | null): LoadLevelEnvelope | null {
  const resources = inputs && isRecord(inputs.resources) ? inputs.resources : null;
  if (!resources) return null;
  const appCpus = numeric(resources.appCpus);
  const appMemoryMb = numeric(resources.appMemoryMb);
  const dbCpus = numeric(resources.dbCpus);
  const dbMemoryMb = numeric(resources.dbMemoryMb);
  if (appCpus === null && appMemoryMb === null && dbCpus === null && dbMemoryMb === null)
    return null;
  return {
    label: `${appCpus ?? "?"}c/${appMemoryMb ?? "?"}MB`,
    appCpus,
    appMemoryMb,
    dbCpus,
    dbMemoryMb,
  };
}

function ordinalOf(run: RunView): LoadLevelOrdinal {
  const inputs = run.inputs ?? {};
  const fixture = isRecord(inputs.fixture) ? inputs.fixture : {};
  const taskCount = numeric(fixture.taskCount) ?? 0;
  const scenarios = Array.isArray(inputs.scenarios) ? inputs.scenarios : [];
  let volume = 0;
  let maxRate = 0;
  for (const scenario of scenarios) {
    if (!isRecord(scenario)) continue;
    if (isRecord(scenario.counts)) {
      for (const value of Object.values(scenario.counts)) volume += numeric(value) ?? 0;
    }
    if (Array.isArray(scenario.ratesPerSecond)) {
      for (const rate of scenario.ratesPerSecond) {
        const value = numeric(rate);
        if (value !== null) maxRate = Math.max(maxRate, value);
      }
    }
  }
  return { taskCount, volume, maxRate };
}

/**
 * Group runs into load levels (`configName × envelope`; runs without a config
 * name group by run-id), newest run first within a level, levels ascending by
 * the derived ordinal.
 */
export function deriveLoadLevels(runs: RunView[]): LoadLevel[] {
  const levels = new Map<string, LoadLevel>();
  for (const run of runs) {
    const envelope = envelopeOf(run.inputs);
    const configName = run.configName;
    const key = configName ? `${configName}@${envelope?.label ?? "default"}` : `run:${run.runId}`;
    let level = levels.get(key);
    if (!level) {
      const ordinal = ordinalOf(run);
      level = {
        key,
        label: configName ? `${configName} @ ${envelope?.label ?? "default"}` : run.runId,
        configName,
        envelope,
        ordinal,
        ordinalProof:
          `tasks ${ordinal.taskCount} · volume ops ${ordinal.volume} · ` +
          `max rate ${ordinal.maxRate}/s`,
        runIds: [],
      };
      levels.set(key, level);
    }
    level.runIds.push(run.runId);
  }
  const ordered = [...levels.values()];
  ordered.sort(
    (a, b) =>
      a.ordinal.taskCount - b.ordinal.taskCount ||
      a.ordinal.volume - b.ordinal.volume ||
      a.ordinal.maxRate - b.ordinal.maxRate ||
      (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  );
  return ordered;
}

/** Deep-link state for compare mode: `#compare=<id>,<id>[&metric=ops]`. */
export interface CompareState {
  runIds: string[];
  metric: string;
}

export function parseCompareHash(hash: string): CompareState {
  const params = new URLSearchParams((hash || "").replace(/^#/, ""));
  const runIds = (params.get("compare") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return { runIds, metric: params.get("metric") || "ops" };
}

export function formatCompareHash(state: CompareState): string {
  const parts = [`compare=${state.runIds.join(",")}`];
  if (state.metric) parts.push(`metric=${state.metric}`);
  return parts.join("&");
}

// ---------------------------------------------------------------------------
// HTML (plan §4.2/§4.3)

/** JSON safe for a data file the shell fetches: no `<`, `>`, `&`, U+2028/9. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const VIEWER_SCRIPT = `(function () {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  var runs = [];
  var levels = [];
  var byId = {};
  var booted = false;
  var loadingEl = document.getElementById("loading");

  var select = document.getElementById("run-select");
  var prevBtn = document.getElementById("run-prev");
  var nextBtn = document.getElementById("run-next");
  var runNav = document.getElementById("run-nav");
  var compareNav = document.getElementById("compare-nav");
  var modeRunBtn = document.getElementById("mode-run");
  var modeCompareBtn = document.getElementById("mode-compare");
  var provEl = document.getElementById("provenance");
  var bodyEl = document.getElementById("view-body");
  var STORAGE_KEY = "bench-results-run";
  var state = { mode: "run", runId: null, cohort: "all", sort: {}, compareIds: [], metric: "ops", hiddenVariants: {} };

  function fmtBytes(v) {
    if (v === null || v === undefined) return "—";
    var units = ["B", "KiB", "MiB", "GiB", "TiB"];
    var n = v, u = 0;
    while (n >= 1024 && u < units.length - 1) { n = n / 1024; u += 1; }
    return (u === 0 ? String(Math.round(n)) : n.toFixed(1)) + " " + units[u];
  }
  function fmtMs(v) {
    if (v === null || v === undefined) return "—";
    return v >= 1000 ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms";
  }
  function fmtNum(v) {
    if (v === null || v === undefined) return "—";
    return Number(v).toFixed(1);
  }
  function fmtInt(v) {
    if (v === null || v === undefined) return "—";
    return String(v);
  }
  function fmtPct(v) {
    if (v === null || v === undefined) return "—";
    return Number(v).toFixed(2) + "%";
  }

  // --- container resources (container-resource-usage-tracking plan) -----------
  function frontUsage(v, resources) {
    if (!resources || !resources.services) return null;
    return resources.services[v.loadService] || null;
  }
  // A per-metric binding-resource fact, e.g. "app CPU 99% of env, RAM 41% → CPU-bound".
  function resourceFact(v, resources, where) {
    var usage = frontUsage(v, resources);
    if (!usage) return null;
    var cpu = usage.maxCpuPctOfEnv, mem = usage.maxMemPctOfEnv;
    var oom = resources.oomKills;
    if ((cpu === null || cpu === undefined) && (mem === null || mem === undefined) && !(oom > 0)) return null;
    var parts = [];
    if (cpu !== null && cpu !== undefined) parts.push("CPU " + fmtNum(cpu) + "% of env");
    if (mem !== null && mem !== undefined) parts.push("RAM " + fmtNum(mem) + "% of env");
    if (oom && oom > 0) parts.push("OOM ×" + oom);
    var binding;
    if (oom && oom > 0) binding = "RAM-bound (OOM)";
    else if (mem === null || mem === undefined) binding = "CPU-bound";
    else if (cpu === null || cpu === undefined) binding = "RAM-bound";
    else binding = cpu >= mem ? "CPU-bound" : "RAM-bound";
    return { kind: "warn", text: where + " — " + parts.join(", ") + " → " + binding };
  }

  // --- inline SVG charts (plan V-A): hand-rolled, no library, no fetch --------
  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    return node;
  }
  function cohortColor(cohort) {
    if (cohort === "next-fullstack") return "#4f46e5";
    if (cohort === "tanstack-start") return "#0891b2";
    if (cohort === "spa-api") return "#b45309";
    return "#64748b";
  }
  // Cohort-coloured vertical bars. items: [{label, value, cohort, title}]
  function barChart(items, opts) {
    opts = opts || {};
    var known = items.filter(function (it) { return it.value !== null && it.value !== undefined; });
    if (!known.length) return el("p", "note chart-empty", "— not measured");
    var height = opts.height || 170;
    var pad = { l: 52, r: 14, t: 12, b: 56 };
    var bar = 26, gap = 10;
    var width = Math.max(opts.minWidth || 360, pad.l + pad.r + known.length * (bar + gap));
    var max = 0;
    known.forEach(function (it) { if (it.value > max) max = it.value; });
    if (!(max > 0)) max = 1;
    var plotH = height - pad.t - pad.b;
    var root = svgEl("svg", { viewBox: "0 0 " + width + " " + height, class: "chart", role: "img" });
    root.appendChild(svgEl("line", { x1: pad.l, y1: pad.t, x2: pad.l, y2: pad.t + plotH, class: "axis" }));
    root.appendChild(svgEl("line", { x1: pad.l, y1: pad.t + plotH, x2: width - pad.r, y2: pad.t + plotH, class: "axis" }));
    var ymax = svgEl("text", { x: pad.l - 6, y: pad.t + 10, "text-anchor": "end", class: "tick" });
    ymax.textContent = fmtNum(max); root.appendChild(ymax);
    known.forEach(function (it, index) {
      var h = (it.value / max) * plotH;
      var x = pad.l + index * (bar + gap) + gap / 2;
      var rect = svgEl("rect", { x: x, y: pad.t + plotH - h, width: bar, height: Math.max(1, h), fill: cohortColor(it.cohort), rx: 2 });
      var rt = svgEl("title", {}); rt.textContent = it.title || (it.label + ": " + fmtNum(it.value)); rect.appendChild(rt);
      root.appendChild(rect);
      var val = svgEl("text", { x: x + bar / 2, y: pad.t + plotH - h - 3, "text-anchor": "middle", class: "tick" });
      val.textContent = fmtNum(it.value); root.appendChild(val);
      var lab = svgEl("text", { x: x + bar / 2, y: pad.t + plotH + 12, "text-anchor": "end", class: "tick", transform: "rotate(-40 " + (x + bar / 2) + " " + (pad.t + plotH + 12) + ")" });
      lab.textContent = it.label; root.appendChild(lab);
    });
    return root;
  }
  // Line chart over categories. series: [{label, color, values:[num|null], title}]
  function lineChart(categories, series, opts) {
    opts = opts || {};
    var anyValue = false;
    series.forEach(function (s) { s.values.forEach(function (v) { if (v !== null && v !== undefined) anyValue = true; }); });
    if (!anyValue || categories.length === 0) return el("p", "note chart-empty", "— not measured");
    var height = opts.height || 180;
    var pad = { l: 56, r: 14, t: 12, b: 40 };
    var width = Math.max(opts.minWidth || 480, pad.l + pad.r + categories.length * 90);
    var plotW = width - pad.l - pad.r, plotH = height - pad.t - pad.b;
    var max = 0;
    series.forEach(function (s) { s.values.forEach(function (v) { if (v !== null && v !== undefined && v > max) max = v; }); });
    if (!(max > 0)) max = 1;
    var root = svgEl("svg", { viewBox: "0 0 " + width + " " + height, class: "chart", role: "img" });
    root.appendChild(svgEl("line", { x1: pad.l, y1: pad.t, x2: pad.l, y2: pad.t + plotH, class: "axis" }));
    root.appendChild(svgEl("line", { x1: pad.l, y1: pad.t + plotH, x2: width - pad.r, y2: pad.t + plotH, class: "axis" }));
    var ymax = svgEl("text", { x: pad.l - 6, y: pad.t + 10, "text-anchor": "end", class: "tick" });
    ymax.textContent = fmtNum(max); root.appendChild(ymax);
    var xAt = function (i) { return categories.length === 1 ? pad.l + plotW / 2 : pad.l + (i / (categories.length - 1)) * plotW; };
    categories.forEach(function (label, i) {
      var t = svgEl("text", { x: xAt(i), y: pad.t + plotH + 14, "text-anchor": "middle", class: "tick" });
      t.textContent = label; root.appendChild(t);
    });
    series.forEach(function (s) {
      var d = "";
      s.values.forEach(function (v, i) {
        if (v === null || v === undefined) return;
        d += (d ? " L " : "M ") + xAt(i) + " " + (pad.t + plotH - (v / max) * plotH);
      });
      if (d) {
        var path = svgEl("path", { d: d, fill: "none", stroke: s.color || "#334155", "stroke-width": 2 });
        var pt = svgEl("title", {}); pt.textContent = s.title || s.label; path.appendChild(pt);
        root.appendChild(path);
      }
    });
    return root;
  }
  function chartLegend(series) {
    var wrap = el("div", "legend-inline");
    series.forEach(function (s) {
      var span = el("span", "legend-item");
      var swatch = el("span", "swatch"); swatch.style.background = s.color || "#334155";
      span.appendChild(swatch); span.appendChild(document.createTextNode(s.label));
      wrap.appendChild(span);
    });
    return wrap;
  }
  // Line chart over numeric x (seconds), so series of different lengths and
  // sample times share one axis — the overlaid resource view needs that.
  // series: [{label, color, title, points: [{x, y}]}] with y skipped when null.
  function xyChart(series, opts) {
    opts = opts || {};
    var anyValue = false, maxX = 0, maxY = 0;
    series.forEach(function (s) {
      s.points.forEach(function (p) {
        if (p.y === null || p.y === undefined) return;
        anyValue = true;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
    });
    if (!anyValue) return el("p", "note chart-empty", "— not measured");
    var height = opts.height || 200;
    var width = opts.width || 780;
    var pad = { l: 56, r: 14, t: 12, b: 34 };
    var plotW = width - pad.l - pad.r, plotH = height - pad.t - pad.b;
    if (!(maxY > 0)) maxY = 1;
    if (!(maxX > 0)) maxX = 1;
    var root = svgEl("svg", { viewBox: "0 0 " + width + " " + height, class: "chart", role: "img" });
    root.appendChild(svgEl("line", { x1: pad.l, y1: pad.t, x2: pad.l, y2: pad.t + plotH, class: "axis" }));
    root.appendChild(svgEl("line", { x1: pad.l, y1: pad.t + plotH, x2: width - pad.r, y2: pad.t + plotH, class: "axis" }));
    [0, maxY / 2, maxY].forEach(function (tv) {
      var y = pad.t + plotH - (tv / maxY) * plotH;
      var t = svgEl("text", { x: pad.l - 6, y: y + 4, "text-anchor": "end", class: "tick" });
      t.textContent = fmtNum(tv); root.appendChild(t);
      if (tv > 0 && tv < maxY) root.appendChild(svgEl("line", { x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: "gridline" }));
    });
    var step = maxX / 4, mag = Math.pow(10, Math.floor(Math.log(step) / Math.LN10));
    var norm = step / mag;
    var nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    var tickStep = nice * mag;
    for (var tv = 0; tv <= maxX + 1e-9; tv += tickStep) {
      var t = svgEl("text", { x: pad.l + (tv / maxX) * plotW, y: pad.t + plotH + 14, "text-anchor": "middle", class: "tick" });
      t.textContent = fmtNum(tv); root.appendChild(t);
    }
    series.forEach(function (s) {
      var d = "";
      s.points.forEach(function (p) {
        if (p.y === null || p.y === undefined) return;
        d += (d ? " L " : "M ") + (pad.l + (p.x / maxX) * plotW) + " " + (pad.t + plotH - (p.y / maxY) * plotH);
      });
      if (d) {
        var path = svgEl("path", { d: d, fill: "none", stroke: s.color || "#334155", "stroke-width": 2 });
        var pt = svgEl("title", {}); pt.textContent = s.title || s.label; path.appendChild(pt);
        root.appendChild(path);
      }
    });
    return root;
  }
  // A stable per-variant colour: golden-angle hues keep neighbours distinct.
  function variantColor(index) {
    return "hsl(" + Math.round((index * 137.508) % 360) + ", 62%, 40%)";
  }
  function thresholdsCell(list) {
    var wrap = el("span", "thresholds");
    if (!list || !list.length) return wrap;
    list.forEach(function (t) {
      var b = el("span", "badge " + (t.ok ? "pass" : "fail"), (t.ok ? "✓ " : "✗ ") + t.metric);
      b.title = t.metric + " " + t.expression + (t.ok ? " (ok)" : " (failed)");
      wrap.appendChild(b);
    });
    return wrap;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function col(id, label, get, fmt, opts) {
    var c = { id: id, label: label, get: get, fmt: fmt };
    if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) c[k] = opts[k];
    return c;
  }

  function idCols() {
    return [
      col("variant", "variant", function (v) { return v.id; }, null, { left: true, title: "variant id" }),
      col("cohort", "cohort", function (v) { return v.cohort; }, null, { left: true })
    ];
  }

  function identityCols() {
    return idCols().concat([
      col("orm", "orm", function (v) { return v.orm; }, null, { left: true }),
      col("read", "read", function (v) { return v.readMode; }, null, { left: true }),
      col("mutation", "mutation", function (v) { return v.mutationMode; }, null, { left: true })
    ]);
  }

  function renderTable(sectionId, columns, rows) {
    var visible = rows.slice();
    if (state.cohort !== "all") {
      visible = visible.filter(function (r) { return r.cohort === state.cohort; });
    }
    var sort = state.sort[sectionId];
    if (sort) {
      var sortCol = null;
      for (var c = 0; c < columns.length; c++) if (columns[c].id === sort.col) sortCol = columns[c];
      if (sortCol) {
        visible.sort(function (a, b) {
          var av = sortCol.get(a), bv = sortCol.get(b);
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          if (typeof av === "number" && typeof bv === "number") return sort.dir * (av - bv);
          var as = String(av), bs = String(bv);
          return sort.dir * (as < bs ? -1 : as > bs ? 1 : 0);
        });
      }
    }
    var leaders = {};
    for (var ci = 0; ci < columns.length; ci++) {
      var column = columns[ci];
      if (!column.numeric || typeof column.lower !== "boolean") continue;
      var best = null, seen = false;
      for (var ri = 0; ri < visible.length; ri++) {
        var value = column.get(visible[ri]);
        if (value === null || value === undefined) continue;
        if (!seen) { best = value; seen = true; }
        else if (column.lower ? value < best : value > best) best = value;
      }
      if (seen) leaders[column.id] = best;
    }
    var table = el("table", "matrix");
    var thead = el("thead");
    var headRow = el("tr");
    for (var h = 0; h < columns.length; h++) {
      (function (column) {
        var th = el("th", "sortable", column.label);
        if (column.title) th.title = column.title;
        if (column.left) th.style.textAlign = "left";
        if (state.sort[sectionId] && state.sort[sectionId].col === column.id) {
          th.className += state.sort[sectionId].dir > 0 ? " sort-asc" : " sort-desc";
        }
        th.addEventListener("click", function () {
          var cur = state.sort[sectionId];
          var dir = cur && cur.col === column.id ? -cur.dir : 1;
          state.sort[sectionId] = { col: column.id, dir: dir };
          render();
        });
        headRow.appendChild(th);
      })(columns[h]);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el("tbody");
    if (visible.length === 0) {
      var emptyRow = el("tr");
      var emptyCell = el("td", "empty", "no variants");
      emptyCell.colSpan = columns.length;
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    }
    for (var r = 0; r < visible.length; r++) {
      (function (row) {
        var tr = el("tr");
        for (var x = 0; x < columns.length; x++) {
          (function (column) {
            var value = column.get(row);
            var cell = el("td", null, null);
            if (column.cell) cell.appendChild(column.cell(value, row));
            else cell.textContent = column.fmt ? column.fmt(value, row) : (value === null || value === undefined ? "—" : String(value));
            if (column.left) cell.style.textAlign = "left";
            if (column.cls) {
              var cls = column.cls(value, row);
              if (cls) cell.className = cls;
            }
            if (column.exact && value !== null && value !== undefined) cell.title = column.exact(value, row);
            if (column.numeric && leaders[column.id] !== undefined && value === leaders[column.id]) {
              cell.className = cell.className ? cell.className + " leader" : "leader";
            }
            tr.appendChild(cell);
          })(columns[x]);
        }
        tbody.appendChild(tr);
      })(visible[r]);
    }
    table.appendChild(tbody);
    return table;
  }

  function sectionTable(sectionId, title, subtitle, columns, rows, hasData, banner, chart) {
    var sec = el("section");
    sec.appendChild(el("h2", null, title));
    if (subtitle) sec.appendChild(el("p", "sub", subtitle));
    if (chart) sec.appendChild(chart);
    if (!hasData) sec.appendChild(banner || el("p", "note", "— not measured in this run."));
    else sec.appendChild(renderTable(sectionId, columns, rows));
    return sec;
  }

  function firstDataOf(v) {
    if (!v.render || !v.render.pages) return null;
    var names = Object.keys(v.render.pages).sort();
    for (var i = 0; i < names.length; i++) {
      var page = v.render.pages[names[i]];
      if (page && page.firstData !== null && page.firstData !== undefined) return page.firstData;
    }
    return null;
  }
  function barsFor(run, valueFn, titleFn) {
    return run.variants.map(function (v) {
      return { label: v.id, value: valueFn(v), cohort: v.cohort, title: (titleFn ? titleFn(v) : v.id) };
    });
  }

  // Plan D2: a run whose config selected no stage renders a banner with the exact
  // re-run command, never a bare empty table. A *requested* stage with no data
  // keeps the plain "not measured" note (attempted-and-failed must look different
  // from never-requested). Pre-D1 runs have requestedStages === null → no banner.
  function notRequested(run, stage) {
    return !!(run.requestedStages && run.requestedStages[stage] === false);
  }
  function notRequestedBanner(run, stage) {
    var labels = { correctness: "correctness", render: "render", load: "load (read-only + mutations)" };
    var p = el("p", "note not-requested");
    p.appendChild(document.createTextNode("Not measured — this run's config selected no " + labels[stage] + " stage. Re-run: "));
    var cmd = "pnpm rig:run --config " + (run.configFile || "<config>");
    p.appendChild(el("code", null, cmd));
    p.appendChild(document.createTextNode(" after setting stages." + stage + ": true, or add --with-" + stage + " for a one-off."));
    return p;
  }
  function bannerFor(run, stage) {
    return notRequested(run, stage) ? notRequestedBanner(run, stage) : null;
  }

  function stageColumns(run) {
    var present = {};
    run.variants.forEach(function (v) { for (var k in v.stages) present[k] = true; });
    var order = ["build", "up", "ready", "reset", "seed", "verifySchema", "verifyDigest", "correctness", "render", "load", "mutations", "teardown"];
    var names = order.filter(function (n) { return present[n]; });
    Object.keys(present).forEach(function (k) { if (order.indexOf(k) < 0) names.push(k); });
    return names.map(function (name) {
      return col("stage:" + name, name, function (v) {
        var s = v.stages && v.stages[name];
        return s ? s.ms : null;
      }, fmtMs, {
        numeric: true,
        lower: true,
        title: name + " wall-clock (lower is better)",
        cls: function (value, row) {
          var s = row.stages && row.stages[name];
          return s && !s.ok ? "badge fail" : "";
        }
      });
    });
  }

  function correctnessColumn() {
    return col("correctness", "correctness", function (v) { return v.correctness; }, null, {
      left: true,
      title: "black-box suite result (needs --with-correctness)",
      cls: function (value) {
        return value === "pass" ? "badge pass" : value === "fail" ? "badge fail" : "";
      }
    });
  }

  function statusColumn() {
    return col("status", "status", function (v) { return v.status; }, null, {
      left: true,
      title: "variant status (failed variants show their error)",
      cell: function (value, row) {
        var wrap = el("span", "status-cell");
        wrap.appendChild(el("span", value === "ok" ? "badge pass" : "badge fail", value || "—"));
        if (row.error) {
          var details = el("details", "error");
          details.appendChild(el("summary", null, "error"));
          details.appendChild(el("pre", null, row.error));
          wrap.appendChild(details);
        }
        return wrap;
      }
    });
  }

  function renderColumns(run) {
    var pages = {};
    run.variants.forEach(function (v) { if (v.render) for (var p in v.render.pages) pages[p] = true; });
    var pageOrder = ["projects", "board", "detail"];
    var pageNames = pageOrder.filter(function (p) { return pages[p]; });
    Object.keys(pages).forEach(function (p) { if (pageOrder.indexOf(p) < 0) pageNames.push(p); });
    var cols = idCols();
    pageNames.forEach(function (page) {
      ["ttfb", "fcp", "lcp", "firstData"].forEach(function (metric) {
        var label = page + " " + (metric === "firstData" ? "data" : metric);
        cols.push(col("render:" + page + ":" + metric, label, function (v) {
          var pg = v.render && v.render.pages && v.render.pages[page];
          if (!pg) return null;
          var value = pg[metric];
          return value === undefined ? null : value;
        }, fmtMs, { numeric: true, lower: true, title: "p50 " + metric + " on /" + page }));
      });
    });
    var interactions = {};
    run.variants.forEach(function (v) { if (v.render) for (var k in v.render.interactions) interactions[k] = true; });
    var iOrder = ["create", "update", "delete", "create-with-comment"];
    var iNames = iOrder.filter(function (k) { return interactions[k]; });
    Object.keys(interactions).forEach(function (k) { if (iOrder.indexOf(k) < 0) iNames.push(k); });
    iNames.forEach(function (name) {
      cols.push(col("interaction:" + name, name + " p50", function (v) {
        var it = v.render && v.render.interactions;
        if (!it) return null;
        return it[name] === undefined ? null : it[name];
      }, fmtMs, { numeric: true, lower: true, title: name + " p50 (lower is better)" }));
    });
    return cols;
  }

  function loadReadColumns() {
    var cols = idCols();
    cols.push(col("load:vus", "devices", function (v) { return v.load ? v.load.vus : null; }, fmtInt, { numeric: true, lower: true, title: "k6 VUs (appCpus × 2)" }));
    cols.push(col("load:ops", "ops/s", function (v) {
      return v.load && !v.load.generatorSaturated ? v.load.opsPerSecond : null;
    }, function (value, row) {
      if (row.load && row.load.generatorSaturated) return "withheld";
      return fmtNum(value);
    }, { numeric: true, lower: false, title: "read ops/sec (higher is better); withheld when the generator saturated" }));
    cols.push(col("load:p95", "p95 ms", function (v) {
      return v.load && !v.load.generatorSaturated ? v.load.p95Ms : null;
    }, function (value, row) {
      if (row.load && row.load.generatorSaturated) return "withheld";
      return fmtNum(value);
    }, { numeric: true, lower: true, title: "read p95 latency (lower is better)" }));
    cols.push(col("load:requests", "requests", function (v) { return v.load ? v.load.requests : null; }, fmtInt, { numeric: true, lower: false, title: "total read requests" }));
    cols.push(col("load:failed", "failed %", function (v) { return v.load ? v.load.failedRate * 100 : null; }, fmtPct, { numeric: true, lower: true, title: "failed request rate (lower is better)" }));
    cols.push(col("load:sat", "generator", function (v) { return v.load ? (v.load.generatorSaturated ? "saturated" : "ok") : null; }, null, {
      title: "generator CPU vs limit",
      cls: function (value) { return value === "saturated" ? "badge fail" : value === "ok" ? "badge pass" : ""; }
    }));
    cols.push(col("load:thresholds", "thresholds", function (v) { return v.load ? v.load.thresholds : null; }, null, {
      cell: function (value) { return thresholdsCell(value); },
      title: "recorded k6 threshold labels (health labels, never gates)"
    }));
    cols.push(col("load:cpu", "CPU% env", function (v) {
      var usage = v.load ? frontUsage(v, v.load.resources) : null;
      return usage ? usage.maxCpuPctOfEnv : null;
    }, function (value) { return value === null || value === undefined ? "—" : fmtNum(value); }, {
      numeric: true, lower: true, title: "peak loaded-service CPU as % of its resource envelope (not of host); lower is better"
    }));
    cols.push(col("load:mem", "MEM% env", function (v) {
      var usage = v.load ? frontUsage(v, v.load.resources) : null;
      return usage ? usage.maxMemPctOfEnv : null;
    }, function (value) { return value === null || value === undefined ? "—" : fmtNum(value); }, {
      numeric: true, lower: true, title: "peak loaded-service RAM as % of its resource envelope"
    }));
    cols.push(col("load:oom", "OOM", function (v) { return v.load && v.load.resources ? v.load.resources.oomKills : null; }, fmtInt, {
      numeric: true, lower: true, title: "OOM kills during the leg (blank = not measured, never zero)"
    }));
    return cols;
  }

  function mutationColumns() {
    var cols = idCols();
    ["create", "update", "delete"].forEach(function (kind) {
      cols.push(col("mut:" + kind, kind + "/s", function (v) {
        var op = v.mutations && v.mutations.perOp[kind];
        return op ? op.rate : null;
      }, fmtNum, { numeric: true, lower: false, title: kind + " ops/sec (higher is better)" }));
    });
    var durations = [["avg", "avg ms"], ["p90", "p90 ms"], ["p95", "p95 ms"], ["p99", "p99 ms"], ["max", "max ms"]];
    durations.forEach(function (pair) {
      cols.push(col("mut:" + pair[0], pair[1], function (v) {
        return v.mutations && v.mutations.duration ? v.mutations.duration[pair[0]] : null;
      }, fmtNum, { numeric: true, lower: true, title: pair[1] + " (lower is better)" }));
    });
    cols.push(col("mut:fail", "failures", function (v) { return v.mutations ? v.mutations.failures : null; }, fmtInt, { numeric: true, lower: true, title: "failed requests (lower is better)" }));
    cols.push(col("mut:thresholds", "thresholds", function (v) { return v.mutations ? v.mutations.thresholds : null; }, null, {
      cell: function (value) { return thresholdsCell(value); },
      title: "recorded k6 threshold labels (health labels, never gates)"
    }));
    cols.push(col("mut:cpu", "CPU% env", function (v) {
      var usage = v.mutations ? frontUsage(v, v.mutations.resources) : null;
      return usage ? usage.maxCpuPctOfEnv : null;
    }, function (value) { return value === null || value === undefined ? "—" : fmtNum(value); }, {
      numeric: true, lower: true, title: "peak loaded-service CPU as % of its resource envelope (not of host)"
    }));
    cols.push(col("mut:mem", "MEM% env", function (v) {
      var usage = v.mutations ? frontUsage(v, v.mutations.resources) : null;
      return usage ? usage.maxMemPctOfEnv : null;
    }, function (value) { return value === null || value === undefined ? "—" : fmtNum(value); }, {
      numeric: true, lower: true, title: "peak loaded-service RAM as % of its resource envelope"
    }));
    return cols;
  }

  function staticColumns() {
    var cols = idCols();
    var exact = function (value) { return value === null || value === undefined ? "" : String(value) + " bytes"; };
    function bucket(prefix, field, label) {
      cols.push(col(prefix + ":files", label + " files", function (v) { return v.inventory ? v.inventory[field].files : null; }, fmtInt, { numeric: true, lower: true, title: "authored " + label + " files" }));
      cols.push(col(prefix + ":loc", label + " loc", function (v) { return v.inventory ? v.inventory[field].loc : null; }, fmtInt, { numeric: true, lower: true, title: "authored " + label + " LOC" }));
      cols.push(col(prefix + ":bytes", label + " bytes", function (v) { return v.inventory ? v.inventory[field].bytes : null; }, fmtBytes, { numeric: true, lower: true, exact: exact, title: "authored " + label + " bytes" }));
    }
    bucket("source", "source", "source");
    bucket("test", "tests", "tests");
    bucket("infra", "infrastructure", "infra");
    cols.push(col("total:files", "total files", function (v) { return v.inventory ? v.inventory.totals.files : null; }, fmtInt, { numeric: true, lower: true, title: "authored files (source+tests+infra)" }));
    cols.push(col("total:loc", "total loc", function (v) { return v.inventory ? v.inventory.totals.loc : null; }, fmtInt, { numeric: true, lower: true, title: "authored LOC" }));
    cols.push(col("total:bytes", "authored size", function (v) { return v.inventory ? v.inventory.totals.bytes : null; }, fmtBytes, { numeric: true, lower: true, exact: exact, title: "authored bytes" }));
    cols.push(col("foot:files", "on-disk files", function (v) { return v.inventory && v.inventory.footprint ? v.inventory.footprint.files : null; }, fmtInt, { numeric: true, lower: true, title: "whole-directory footprint incl. deps/build (du)" }));
    cols.push(col("foot:bytes", "on-disk size", function (v) { return v.inventory && v.inventory.footprint ? v.inventory.footprint.bytes : null; }, fmtBytes, { numeric: true, lower: true, exact: exact, title: "whole-directory footprint incl. deps/build (du)" }));
    cols.push(col("deps", "direct deps", function (v) { return v.inventory ? v.inventory.directDependencies : null; }, fmtInt, {
      numeric: true, lower: true,
      title: "direct dependencies (lower is better); per-manifest breakdown in the tooltip",
      exact: function (value, row) {
        var m = row.inventory && row.inventory.dependencyManifests;
        if (!m || !m.length) return String(value) + " direct dependencies";
        return m.map(function (x) { return x.path + ": " + x.directDependencies; }).join(" + ");
      }
    }));
    cols.push(col("langs", "languages", function (v) { return v.inventory ? v.inventory.languages : null; }, fmtInt, { numeric: true, lower: true }));
    cols.push(col("services", "services", function (v) { return v.inventory ? v.inventory.serviceCount : null; }, fmtInt, { numeric: true, lower: true }));
    cols.push(col("images", "images", function (v) { return v.inventory ? v.inventory.imageCount : null; }, fmtInt, { numeric: true, lower: true }));
    return cols;
  }

  function renderProvenance(run) {
    provEl.textContent = "";
    function chip(label, value, title) {
      var span = el("span", "chip");
      span.appendChild(el("strong", null, label + " "));
      span.appendChild(document.createTextNode(value === null || value === undefined ? "—" : String(value)));
      if (title) span.title = title;
      provEl.appendChild(span);
    }
    chip("config", run.configName || "—");
    chip("source", run.configFile || "—");
    chip("git", run.gitRevision ? run.gitRevision.slice(0, 7) : "—", run.gitRevision || "");
    chip("sha256", run.effectiveManifestSha256 ? run.effectiveManifestSha256.slice(0, 10) + "…" : "—", run.effectiveManifestSha256 || "");
    chip("variants", run.okCount + "/" + run.totalCount + " ok");
    if (run.startedAt) chip("started", run.startedAt);
    if (run.incomplete) provEl.appendChild(el("span", "badge warn", "incomplete"));
  }

  function fmtValue(v) {
    if (v === null || v === undefined) return "—";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "object") {
      var parts = [];
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) parts.push(k + " " + v[k]);
      return parts.join(", ");
    }
    return String(v);
  }
  function kvTable(pairs) {
    var table = el("table", "kv");
    var tbody = el("tbody");
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i][1] === undefined) continue;
      var tr = el("tr");
      tr.appendChild(el("th", null, pairs[i][0]));
      tr.appendChild(el("td", null, fmtValue(pairs[i][1])));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }
  function kvCard(title, obj, order) {
    var card = el("div", "card");
    card.appendChild(el("h3", null, title));
    var pairs = [];
    for (var i = 0; i < order.length; i++) pairs.push([order[i], obj[order[i]]]);
    card.appendChild(kvTable(pairs));
    return card;
  }
  function scenarioCard(scenarios) {
    var card = el("div", "card wide");
    card.appendChild(el("h3", null, "Scenarios"));
    for (var i = 0; i < scenarios.length; i++) {
      var s = scenarios[i];
      var block = el("div", "scenario");
      block.appendChild(el("h4", null, s.id + " (" + s.kind + ")"));
      var order = [];
      if (s.counts) order.push("counts");
      if (s.weights) order.push("weights");
      order.push("concurrency", "ratesPerSecond", "durationPerStepSeconds", "preallocatedVUs", "maxVUs", "maxAttemptsPerOperation", "maxDurationSeconds", "resetBefore");
      var pairs = [];
      for (var j = 0; j < order.length; j++) pairs.push([order[j], s[order[j]]]);
      block.appendChild(kvTable(pairs));
      if (s.kind === "capacity") block.appendChild(el("p", "note", "capacity ladder — executed as a constant-arrival-rate ladder (plan K3); see the capacity section for the steps."));
      card.appendChild(block);
    }
    return card;
  }
  function renderInputs(run) {
    var details = el("details", "inputs");
    details.appendChild(el("summary", null, "Inputs (effective config)"));
    var grid = el("div", "input-grid");
    if (!run.inputs) {
      grid.appendChild(el("p", "note", "— no effective-config.yaml for this run."));
    } else {
      var inp = run.inputs;
      if (inp.fixture) grid.appendChild(kvCard("Fixture", inp.fixture, ["seedVersion", "seed", "projectCount", "userCount", "taskCount", "commentCount", "baseTimestamp", "statusPercent", "workingSetFraction"]));
      if (inp.scenarios) grid.appendChild(scenarioCard(inp.scenarios));
      if (inp.browser) grid.appendChild(kvCard("Browser", inp.browser, ["engine", "workers", "warmupSamples", "measuredSamples", "viewport", "cacheProfile", "prefetch", "operations"]));
      if (inp.resources) grid.appendChild(kvCard("Resources", inp.resources, ["appCpus", "appMemoryMb", "dbCpus", "dbMemoryMb"]));
      if (inp.network) grid.appendChild(kvCard("Network", inp.network, ["browserToAppAddedRttMs", "appToApiAddedRttMs"]));
      if (inp.reset) grid.appendChild(kvCard("Reset", inp.reset, ["betweenPhases", "betweenTrials", "method"]));
      var runCard = el("div", "card");
      runCard.appendChild(el("h3", null, "Run"));
      runCard.appendChild(kvTable([["trials", inp.trials], ["variantOrder", inp.variantOrder], ["variants", inp.variants ? inp.variants.length : undefined], ["stages", run.requestedStages || undefined], ["only", run.only && run.only.length ? run.only : undefined]]));
      grid.appendChild(runCard);
    }
    details.appendChild(grid);
    return details;
  }

  function cohortChips(run) {
    var wrap = el("div", "chips");
    var cohorts = ["all"];
    run.variants.forEach(function (v) { if (cohorts.indexOf(v.cohort) < 0) cohorts.push(v.cohort); });
    cohorts.forEach(function (name) {
      var button = el("button", "chip-btn" + (state.cohort === name ? " active" : ""), name === "all" ? "All cohorts" : name);
      button.type = "button";
      button.addEventListener("click", function () { state.cohort = name; render(); });
      wrap.appendChild(button);
    });
    return wrap;
  }

  function render() {
    if (state.mode === "compare") { renderCompare(); return; }
    var run = state.runId ? byId[state.runId] : null;
    bodyEl.textContent = "";
    if (!run) {
      provEl.textContent = "";
      bodyEl.appendChild(el("p", "note", "No runs found under results/."));
      return;
    }
    document.title = "Results — " + run.runId;
    renderProvenance(run);
    bodyEl.appendChild(cohortChips(run));
    bodyEl.appendChild(renderInputs(run));

    bodyEl.appendChild(sectionTable("Lifecycle", "Lifecycle", "status + build/up/seed/verify wall-clock per variant; blank = not run", identityCols().concat([statusColumn()]).concat(stageColumns(run)), run.variants, run.variants.length > 0));

    var anyCorrectness = run.variants.some(function (v) { return v.correctness !== null; });
    bodyEl.appendChild(sectionTable("Correctness", "Correctness", "black-box suite result", idCols().concat([correctnessColumn()]), run.variants, anyCorrectness, bannerFor(run, "correctness")));

    var anyRender = run.variants.some(function (v) { return v.render !== null; });
    var renderChart = anyRender ? barChart(barsFor(run, firstDataOf, function (v) { return v.id + " first-data p50"; }), {}) : null;
    bodyEl.appendChild(sectionTable("Render", "Render", "p50 of raw samples — indicative single-host", renderColumns(run), run.variants, anyRender, bannerFor(run, "render"), renderChart));

    var anyLoad = run.variants.some(function (v) { return v.load !== null; });
    var opsChart = anyLoad ? barChart(barsFor(run, function (v) { return v.load && !v.load.generatorSaturated ? v.load.opsPerSecond : null; }, function (v) { return v.id + " read ops/s"; }), {}) : null;
    bodyEl.appendChild(sectionTable("Load-read", "Load — read-only capacity", "k6 read leg; a generator-saturated trial is withheld", loadReadColumns(), run.variants, anyLoad, bannerFor(run, "load"), opsChart));

    var anyPaths = run.variants.some(function (v) { return v.load && v.load.paths && Object.keys(v.load.paths).length > 0; });
    if (anyPaths) bodyEl.appendChild(pathSection(run));

    var anyMutations = run.variants.some(function (v) { return v.mutations !== null; });
    var mutChart = anyMutations ? barChart(barsFor(run, function (v) { return v.mutations && v.mutations.perOp.create ? v.mutations.perOp.create.rate : null; }, function (v) { return v.id + " create ops/s"; }), {}) : null;
    bodyEl.appendChild(sectionTable("Load-mutations", "Load — mutation volume", "k6 volume leg; per-op rate + latency percentiles", mutationColumns(), run.variants, anyMutations, bannerFor(run, "load"), mutChart));

    var anyCapacity = run.variants.some(function (v) { return v.capacity && v.capacity.steps && v.capacity.steps.length > 0; });
    if (anyCapacity) bodyEl.appendChild(capacitySection(run));

    var resourceSec = resourceSection(run);
    if (resourceSec) bodyEl.appendChild(resourceSec);

    var anyInventory = run.variants.some(function (v) { return v.inventory !== null; });
    bodyEl.appendChild(sectionTable("Static", "Static & complexity", "authored source vs on-disk footprint; bytes human-readable (exact in title)", staticColumns(), run.variants, anyInventory));
  }

  function pathSection(run) {
    var sec = el("section");
    sec.appendChild(el("h2", null, "Load — read latency by path"));
    sec.appendChild(el("p", "sub", "p50/p95 of http_req_duration{path:…} sub-metrics (plan K1)"));
    var table = el("table", "matrix");
    var thead = el("thead"), hr = el("tr");
    ["variant", "path", "p50 ms", "p95 ms"].forEach(function (label, idx) {
      var th = el("th", null, label);
      if (idx < 2) th.style.textAlign = "left";
      hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el("tbody");
    var rows = [];
    run.variants.forEach(function (v) {
      if (state.cohort !== "all" && v.cohort !== state.cohort) return;
      if (!v.load || !v.load.paths) return;
      Object.keys(v.load.paths).sort().forEach(function (path) {
        var entry = v.load.paths[path];
        rows.push({ id: v.id, path: path, p50: entry.p50Ms, p95: entry.p95Ms });
      });
    });
    if (!rows.length) {
      var er = el("tr"), ec = el("td", "empty", "no per-path data"); ec.colSpan = 4; er.appendChild(ec); tbody.appendChild(er);
    }
    rows.forEach(function (r) {
      var tr = el("tr");
      var c1 = el("td", null, r.id); c1.style.textAlign = "left"; tr.appendChild(c1);
      var c2 = el("td", null, r.path); c2.style.textAlign = "left"; tr.appendChild(c2);
      tr.appendChild(el("td", null, fmtNum(r.p50)));
      tr.appendChild(el("td", null, fmtNum(r.p95)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sec.appendChild(table);
    return sec;
  }

  function capacitySection(run) {
    var sec = el("section");
    sec.appendChild(el("h2", null, "Load — capacity ladder (tip-over)"));
    sec.appendChild(el("p", "sub", "constant-arrival-rate: achieved vs target, p95 and dropped iterations per step. Read-weighted mixed capacity (plan K3) — not a mutation-capacity claim."));
    var withCap = run.variants.filter(function (v) { return v.capacity && v.capacity.steps && v.capacity.steps.length; });
    var rates = [];
    withCap.forEach(function (v) { v.capacity.steps.forEach(function (s) { if (rates.indexOf(s.targetRate) < 0) rates.push(s.targetRate); }); });
    rates.sort(function (a, b) { return a - b; });
    var series = withCap.map(function (v) {
      var byRate = {};
      v.capacity.steps.forEach(function (s) { byRate[s.targetRate] = s; });
      return {
        label: v.id, color: cohortColor(v.cohort), title: v.id + " achieved req/s",
        values: rates.map(function (r) { var s = byRate[r]; return s ? (s.generatorSaturated ? null : s.achievedPerSecond) : null; })
      };
    });
    sec.appendChild(lineChart(rates.map(function (r) { return r + "/s"; }), series, {}));
    sec.appendChild(chartLegend(series));
    var table = el("table", "matrix");
    var thead = el("thead"), hr = el("tr");
    ["variant", "target", "achieved", "p95 ms", "p99 ms", "dropped", "VUs", "CPU% env", "MEM% env", "generator", "thresholds", "mode"].forEach(function (label, idx) {
      var th = el("th", null, label); if (idx === 0) th.style.textAlign = "left"; hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el("tbody");
    withCap.forEach(function (v) {
      if (state.cohort !== "all" && v.cohort !== state.cohort) return;
      v.capacity.steps.forEach(function (s) {
        var tr = el("tr");
        var c0 = el("td", null, v.id); c0.style.textAlign = "left"; tr.appendChild(c0);
        tr.appendChild(el("td", null, String(s.targetRate) + "/s"));
        tr.appendChild(el("td", null, s.generatorSaturated ? "withheld" : fmtNum(s.achievedPerSecond)));
        tr.appendChild(el("td", null, s.generatorSaturated ? "withheld" : fmtNum(s.p95Ms)));
        tr.appendChild(el("td", null, fmtNum(s.p99Ms)));
        tr.appendChild(el("td", null, s.droppedIterations === null || s.droppedIterations === undefined ? "—" : String(s.droppedIterations)));
        tr.appendChild(el("td", null, s.vusMax === null || s.vusMax === undefined ? "—" : String(s.vusMax)));
        var stepUsage = frontUsage(v, s.resources);
        tr.appendChild(el("td", null, stepUsage ? fmtNum(stepUsage.maxCpuPctOfEnv) : "—"));
        tr.appendChild(el("td", null, stepUsage ? fmtNum(stepUsage.maxMemPctOfEnv) : "—"));
        tr.appendChild(el("td", null, s.generatorSaturated ? "saturated" : "ok"));
        var tc = el("td"); tc.appendChild(thresholdsCell(s.thresholds)); tr.appendChild(tc);
        tr.appendChild(el("td", null, v.capacity.mixed ? "mixed" : "read-only"));
        tbody.appendChild(tr);
      });
    });
    table.appendChild(tbody);
    sec.appendChild(table);
    var notApplicable = run.variants.filter(function (v) { return v.capacity && v.capacity.applicable === false; });
    if (notApplicable.length) sec.appendChild(el("p", "note", "not applicable for: " + notApplicable.map(function (v) { return v.id; }).join(", ")));
    return sec;
  }

  // CPU%/RAM% over time per leg (container-resource plan U4). The raw 1 Hz
  // series is downsampled at build time; nothing is embedded that is not a view.
  function resourceSection(run) {
    var withSeries = run.variants.filter(function (v) { return v.resourceSeries && v.resourceSeries.length; });
    if (!withSeries.length) return null;
    var sec = el("section");
    sec.appendChild(el("h2", null, "Resources — CPU/RAM over time"));
    sec.appendChild(el("p", "sub", "percent of the loaded service's resource envelope (not of host); 1 Hz samples, downsampled. Blank = not measured."));
    withSeries.forEach(function (v) {
      if (state.cohort !== "all" && v.cohort !== state.cohort) return;
      var card = el("div", "card wide");
      card.appendChild(el("h3", null, v.id + " — " + v.loadService));
      v.resourceSeries.forEach(function (leg) {
        card.appendChild(el("h4", null, leg.label));
        var categories = leg.points.map(function (p) { return Math.round(p.t / 1000) + "s"; });
        var series = [
          { label: "CPU % of envelope", color: cohortColor(v.cohort), title: v.id + " " + leg.label + " CPU % of envelope", values: leg.points.map(function (p) { return p.cpu; }) },
          { label: "RAM % of envelope", color: "#b45309", title: v.id + " " + leg.label + " RAM % of envelope", values: leg.points.map(function (p) { return p.mem; }) }
        ];
        card.appendChild(lineChart(categories, series, { height: 150, minWidth: 420 }));
      });
      sec.appendChild(card);
    });

    // Overlaid comparison (plan U4-2): one line per variant on shared time
    // axes, so each leg can be read variant against variant. Legs are ordered
    // read first, capacity rates ascending, mutations last.
    var legOrder = [];
    withSeries.forEach(function (v) {
      v.resourceSeries.forEach(function (leg) { if (legOrder.indexOf(leg.label) < 0) legOrder.push(leg.label); });
    });
    legOrder.sort(function (a, b) {
      var rank = function (label) { return label === "read" ? -1 : label === "mutations" ? 1 : 0; };
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      var na = parseFloat(a), nb = parseFloat(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    var overlayVariants = withSeries.filter(function (v) { return state.cohort === "all" || v.cohort === state.cohort; });
    var colors = {};
    overlayVariants.forEach(function (v, i) { colors[v.id] = variantColor(i); });
    legOrder.forEach(function (label) {
      var legOf = function (v) {
        for (var i = 0; i < v.resourceSeries.length; i++) if (v.resourceSeries[i].label === label) return v.resourceSeries[i];
        return null;
      };
      var cpuSeries = [], memSeries = [];
      overlayVariants.forEach(function (v) {
        var leg = legOf(v);
        if (!leg) return;
        cpuSeries.push({ label: v.id, color: colors[v.id], title: v.id + " " + label + " CPU % of envelope", points: leg.points.map(function (p) { return { x: p.t / 1000, y: p.cpu }; }) });
        memSeries.push({ label: v.id, color: colors[v.id], title: v.id + " " + label + " RAM % of envelope", points: leg.points.map(function (p) { return { x: p.t / 1000, y: p.mem }; }) });
      });
      if (!cpuSeries.length) return;
      var card = el("div", "card wide");
      card.appendChild(el("h3", null, "Overlaid — " + label));
      card.appendChild(el("h4", null, "CPU % of envelope"));
      card.appendChild(xyChart(cpuSeries, { height: 200 }));
      card.appendChild(el("h4", null, "RAM % of envelope"));
      card.appendChild(xyChart(memSeries, { height: 200 }));
      sec.appendChild(card);
    });
    if (overlayVariants.length > 1)
      sec.appendChild(chartLegend(overlayVariants.map(function (v) { return { label: v.id, color: colors[v.id] }; })));
    sec.appendChild(chartLegend([
      { label: "CPU % of envelope", color: "#4f46e5" },
      { label: "RAM % of envelope", color: "#b45309" }
    ]));
    return sec;
  }

  function selectRun(runId, push) {
    if (!byId[runId]) runId = runs.length ? runs[0].runId : null;
    state.mode = "run";
    state.runId = runId;
    state.cohort = "all";
    if (select && select.value !== runId && runId) select.value = runId;
    if (push && runId) { try { location.hash = runId; } catch (e) {} }
    try { if (runId) localStorage.setItem(STORAGE_KEY, runId); } catch (e) {}
    syncModeChrome();
    render();
  }
  function step(delta) {
    var index = -1;
    for (var i = 0; i < runs.length; i++) if (runs[i].runId === state.runId) { index = i; break; }
    if (index < 0) return;
    var target = index + delta;
    if (target < 0 || target >= runs.length) return;
    selectRun(runs[target].runId, true);
  }

  // --- compare mode (plan V-B) ----------------------------------------------
  var METRICS = {
    ops: { label: "read ops/s", lower: false,
      get: function (v) { return v.load && !v.load.generatorSaturated ? v.load.opsPerSecond : null; },
      withheld: function (v) { return !!(v.load && v.load.generatorSaturated); } },
    p95: { label: "read p95 ms", lower: true,
      get: function (v) { return v.load && !v.load.generatorSaturated ? v.load.p95Ms : null; },
      withheld: function (v) { return !!(v.load && v.load.generatorSaturated); } },
    "render-firstData": { label: "render first-data p50 ms", lower: true,
      get: function (v) { return firstDataOf(v); }, withheld: function () { return false; } },
    "mut-create": { label: "create ops/s", lower: false,
      get: function (v) { return v.mutations && v.mutations.perOp.create ? v.mutations.perOp.create.rate : null; },
      withheld: function () { return false; } }
  };
  var metricOf = function () { return METRICS[state.metric] || METRICS.ops; };

  function compareHash(ids, metric) { return "compare=" + ids.join(",") + (metric ? "&metric=" + metric : ""); }
  function parseHash(hashStr) {
    var h = (hashStr || "").replace(/^#/, "");
    if (h.indexOf("compare=") === 0 || h.indexOf("metric=") === 0 || h.indexOf("&") >= 0) {
      var params = {};
      h.split("&").forEach(function (pair) { var eq = pair.indexOf("="); if (eq >= 0) params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1)); });
      if (params.compare !== undefined || params.metric !== undefined) {
        return {
          mode: "compare", metric: params.metric || "ops",
          runIds: (params.compare || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean)
        };
      }
    }
    return { mode: "run", runId: h || null };
  }
  function pushHash() {
    try {
      if (state.mode === "compare") location.hash = compareHash(state.compareIds, state.metric);
      else if (state.runId) location.hash = state.runId;
    } catch (e) {}
  }
  function envLabelOf(r) {
    if (!r) return "default";
    return (r.appCpus === undefined ? "?" : r.appCpus) + "c/" + (r.appMemoryMb === undefined ? "?" : r.appMemoryMb) + "MB";
  }
  function levelKeyOf(run) {
    var env = run.inputs && run.inputs.resources ? envLabelOf(run.inputs.resources) : "default";
    return run.configName ? run.configName + "@" + env : "run:" + run.runId;
  }
  function compareLabel(run) {
    return (run.configName || "unknown-config") + " — " + run.runId + " (" + run.okCount + "/" + run.totalCount + ")" + (run.incomplete ? " · incomplete" : "");
  }
  function defaultCompareIds() { return levels.map(function (lvl) { return lvl.runIds[0]; }).filter(Boolean); }
  function compareLevels() {
    var selected = state.compareIds.filter(function (id) { return byId[id]; });
    var orderByKey = {};
    for (var i = 0; i < levels.length; i++) orderByKey[levels[i].key] = i;
    var map = {};
    selected.forEach(function (id) {
      var run = byId[id];
      var key = levelKeyOf(run);
      if (!map[key]) map[key] = { key: key, run: run };
    });
    var arr = [];
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) arr.push(map[k]);
    arr.forEach(function (lvl) {
      var meta = null;
      for (var j = 0; j < levels.length; j++) if (levels[j].key === lvl.key) meta = levels[j];
      lvl.meta = meta;
    });
    arr.sort(function (a, b) {
      var ai = a.meta ? orderByKey[a.key] : 999, bi = b.meta ? orderByKey[b.key] : 999;
      if (ai !== bi) return ai - bi;
      return a.key < b.key ? -1 : 1;
    });
    return arr;
  }
  function variantOf(col, id) {
    for (var i = 0; i < col.run.variants.length; i++) if (col.run.variants[i].id === id) return col.run.variants[i];
    return null;
  }

  function honestyStrip(cols) {
    var notes = [];
    var uniq = function (arr) { var seen = {}, out = []; arr.forEach(function (x) { if (x !== null && x !== undefined && !seen[x]) { seen[x] = 1; out.push(x); } }); return out; };
    var revs = uniq(cols.map(function (c) { return c.run.gitRevision; }));
    if (revs.length > 1) notes.push("different git revisions (" + revs.length + ")");
    var shas = uniq(cols.map(function (c) { return c.run.effectiveManifestSha256; }));
    if (shas.length > 1) notes.push("different effective-config sha256 (" + shas.length + ") — inputs differ");
    var sets = uniq(cols.map(function (c) { return c.run.variants.map(function (v) { return v.id; }).sort().join("|"); }));
    if (sets.length > 1) notes.push("different variant sets");
    var stageSigs = uniq(cols.map(function (c) { var s = c.run.requestedStages; return s ? (s.correctness ? "1" : "0") + (s.render ? "1" : "0") + (s.load ? "1" : "0") : "?"; }));
    if (stageSigs.length > 1) notes.push("stages requested differ between runs");
    var wrap = el("div", "honesty");
    if (!notes.length) wrap.appendChild(el("span", "note", "compared runs share revision, inputs, variant set and stage selection"));
    else {
      wrap.appendChild(el("strong", null, "comparison caveats: "));
      notes.forEach(function (n) { wrap.appendChild(el("span", "badge warn", n)); });
    }
    return wrap;
  }

  function deepGet(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) { if (!cur || typeof cur !== "object") return undefined; cur = cur[path[i]]; }
    return cur;
  }
  function inputRows() {
    return [
      { label: "config", get: function (r) { return r.run.configName || "—"; } },
      { label: "envelope (app)", get: function (r) { return r.meta && r.meta.envelope ? r.meta.envelope.label : "—"; } },
      { label: "stages", get: function (r) { var s = r.run.requestedStages; return s ? (["correctness", "render", "load"].filter(function (k) { return s[k]; }).join("+") || "none") : "—"; } },
      { label: "trials", get: function (r) { return deepGet(r.run.inputs, ["trials"]); } },
      { label: "fixture taskCount", get: function (r) { return deepGet(r.run.inputs, ["fixture", "taskCount"]); } },
      { label: "fixture projectCount", get: function (r) { return deepGet(r.run.inputs, ["fixture", "projectCount"]); } },
      { label: "fixture userCount", get: function (r) { return deepGet(r.run.inputs, ["fixture", "userCount"]); } },
      { label: "fixture commentCount", get: function (r) { return deepGet(r.run.inputs, ["fixture", "commentCount"]); } },
      { label: "browser measuredSamples", get: function (r) { return deepGet(r.run.inputs, ["browser", "measuredSamples"]); } },
      { label: "volume counts", get: function (r) { return volumeSummary(r.run.inputs).counts; } },
      { label: "volume concurrency", get: function (r) { return volumeSummary(r.run.inputs).concurrency; } },
      { label: "capacity rates/s", get: function (r) { return capacitySummary(r.run.inputs).rates; } },
      { label: "capacity step s", get: function (r) { return capacitySummary(r.run.inputs).duration; } },
      { label: "load ordinal (derivation)", get: function (r) { return r.meta ? r.meta.ordinalProof : "—"; } },
      { label: "git revision", get: function (r) { return r.run.gitRevision ? r.run.gitRevision.slice(0, 10) : "—"; } },
      { label: "effective sha256", get: function (r) { return r.run.effectiveManifestSha256 ? r.run.effectiveManifestSha256.slice(0, 12) : "—"; } },
      { label: "variants ok", get: function (r) { return r.run.okCount + "/" + r.run.totalCount; } }
    ];
  }
  function volumeSummary(inputs) {
    var scenarios = inputs && Array.isArray(inputs.scenarios) ? inputs.scenarios : [];
    for (var i = 0; i < scenarios.length; i++) {
      if (scenarios[i] && scenarios[i].counts) {
        var counts = scenarios[i].counts, total = 0;
        for (var k in counts) if (Object.prototype.hasOwnProperty.call(counts, k)) total += Number(counts[k]) || 0;
        return { counts: total, concurrency: scenarios[i].concurrency };
      }
    }
    return { counts: "—", concurrency: "—" };
  }
  function capacitySummary(inputs) {
    var scenarios = inputs && Array.isArray(inputs.scenarios) ? inputs.scenarios : [];
    for (var i = 0; i < scenarios.length; i++) {
      if (scenarios[i] && scenarios[i].kind === "capacity") {
        return { rates: (scenarios[i].ratesPerSecond || []).join(","), duration: scenarios[i].durationPerStepSeconds };
      }
    }
    return { rates: "—", duration: "—" };
  }

  function compareInputs(cols) {
    var sec = el("section");
    sec.appendChild(el("h2", null, "Inputs side-by-side"));
    sec.appendChild(el("p", "sub", "the deltas behind every metric: fixture, counts, resources, stages (differing cells highlighted)"));
    var rows = inputRows();
    var table = el("table", "matrix compare");
    var thead = el("thead"), hr = el("tr");
    var corner = el("th", null, "input"); corner.style.textAlign = "left"; hr.appendChild(corner);
    cols.forEach(function (c) { hr.appendChild(el("th", null, c.meta ? c.meta.label : c.run.runId)); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el("tbody");
    rows.forEach(function (row) {
      var values = cols.map(function (c) { return row.get(c); });
      var strings = values.map(function (v) { return v === undefined || v === null ? "—" : String(v); });
      var differs = strings.some(function (s) { return s !== strings[0]; });
      var tr = el("tr");
      var th = el("td", "rowlabel", row.label); th.style.textAlign = "left"; tr.appendChild(th);
      strings.forEach(function (s) {
        var td = el("td", differs ? "diff" : null, s);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sec.appendChild(table);
    return sec;
  }

  function compareGrid(cols) {
    var metric = metricOf();
    var sec = el("section");
    sec.appendChild(el("h2", null, "Metric grid — " + metric.label));
    sec.appendChild(el("p", "sub", "variant rows × load levels; the per-metric leader is bolded (no composite score). Blank = not measured; withheld = generator saturated."));
    var ids = [];
    cols.forEach(function (c) { c.run.variants.forEach(function (v) { if (ids.indexOf(v.id) < 0) ids.push(v.id); }); });
    ids.sort();
    var table = el("table", "matrix compare");
    var thead = el("thead"), hr = el("tr");
    var corner = el("th", null, "variant"); corner.style.textAlign = "left"; hr.appendChild(corner);
    cols.forEach(function (c) { hr.appendChild(el("th", null, c.meta ? c.meta.label : c.run.runId)); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el("tbody");
    ids.forEach(function (id) {
      var values = cols.map(function (c) { var v = variantOf(c, id); return v ? metric.get(v) : null; });
      var best = null;
      values.forEach(function (val) { if (val === null || val === undefined) return; if (best === null || (metric.lower ? val < best : val > best)) best = val; });
      var tr = el("tr");
      var first = el("td", null, id); first.style.textAlign = "left"; tr.appendChild(first);
      values.forEach(function (val, i) {
        var v = variantOf(cols[i], id);
        var td = el("td", null, null);
        if (!v) td.textContent = "—";
        else if (metric.withheld(v)) td.textContent = "withheld";
        else td.textContent = fmtNum(val);
        if (val !== null && best !== null && val === best) td.className = "leader";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sec.appendChild(table);
    return sec;
  }

  function scalingChart(cols) {
    var metric = metricOf();
    var sec = el("section");
    sec.appendChild(el("h2", null, "Scaling — " + metric.label + " vs load level"));
    sec.appendChild(el("p", "sub", "one line per variant; click a legend item to hide/show it"));
    var ids = [];
    cols.forEach(function (c) { c.run.variants.forEach(function (v) { if (ids.indexOf(v.id) < 0) ids.push(v.id); }); });
    ids.sort();
    var categories = cols.map(function (c) { return c.meta ? c.meta.label : c.run.runId; });
    var series = ids.filter(function (id) { return !state.hiddenVariants[id]; }).map(function (id) {
      var cohort = null;
      cols.forEach(function (c) { var v = variantOf(c, id); if (v && !cohort) cohort = v.cohort; });
      return {
        id: id, label: id, color: cohortColor(cohort), title: id,
        values: cols.map(function (c) { var v = variantOf(c, id); return v ? metric.get(v) : null; })
      };
    });
    sec.appendChild(lineChart(categories, series, { height: 220, minWidth: 560 }));
    var legend = el("div", "legend-inline");
    ids.forEach(function (id) {
      var cohort = null;
      cols.forEach(function (c) { var v = variantOf(c, id); if (v && !cohort) cohort = v.cohort; });
      var btn = el("button", "legend-item" + (state.hiddenVariants[id] ? " off" : ""), null);
      btn.type = "button";
      var swatch = el("span", "swatch"); swatch.style.background = cohortColor(cohort); btn.appendChild(swatch);
      btn.appendChild(document.createTextNode(id));
      btn.addEventListener("click", function () { state.hiddenVariants[id] = !state.hiddenVariants[id]; render(); });
      legend.appendChild(btn);
    });
    sec.appendChild(legend);
    return sec;
  }

  function tipOverSection(cols) {
    var sec = el("section");
    sec.appendChild(el("h2", null, "Tip-over facts"));
    sec.appendChild(el("p", "sub", "per-metric facts, never a composite score"));
    var ids = [];
    cols.forEach(function (c) { c.run.variants.forEach(function (v) { if (ids.indexOf(v.id) < 0) ids.push(v.id); }); });
    ids.sort();
    var table = el("table", "matrix compare");
    var thead = el("thead"), hr = el("tr");
    var corner = el("th", null, "variant"); corner.style.textAlign = "left"; hr.appendChild(corner);
    var factsHead = el("th", null, "facts"); factsHead.style.textAlign = "left"; hr.appendChild(factsHead);
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el("tbody");
    ids.forEach(function (id) {
      var facts = [];
      var prevP95 = null, prevOps = null, prevLabel = null;
      cols.forEach(function (c) {
        var v = variantOf(c, id);
        var label = c.meta ? c.meta.label : c.run.runId;
        if (!v) { prevLabel = label; return; }
        if (v.correctness === "fail") facts.push({ kind: "fail", text: "correctness fail at " + label });
        if (v.load) {
          if (v.load.generatorSaturated) facts.push({ kind: "warn", text: "withheld (generator) at " + label });
          else {
            if (v.load.failedRate > 0) facts.push({ kind: "fail", text: "errors (" + (v.load.failedRate * 100).toFixed(2) + "%) at " + label });
            if (prevP95 !== null && v.load.p95Ms !== null && prevP95 > 0 && v.load.p95Ms >= prevP95 * 4) {
              facts.push({ kind: "warn", text: "p95 ×" + (v.load.p95Ms / prevP95).toFixed(1) + " at " + label });
            }
            if (prevOps !== null && v.load.opsPerSecond !== null && prevOps > 0 && v.load.opsPerSecond <= prevOps * 1.02) {
              facts.push({ kind: "warn", text: "throughput flat/declining " + prevLabel + "→" + label });
            }
            var loadUsage = frontUsage(v, v.load.resources);
            if (loadUsage && (loadUsage.maxCpuPctOfEnv >= 90 || (v.load.resources && v.load.resources.oomKills > 0))) {
              var loadFact = resourceFact(v, v.load.resources, "read leg at " + label);
              if (loadFact) facts.push(loadFact);
            }
            prevP95 = v.load.p95Ms; prevOps = v.load.opsPerSecond;
          }
        }
        if (v.capacity && v.capacity.steps && v.capacity.steps.length) {
          v.capacity.steps.forEach(function (s) {
            if (s.droppedIterations && s.droppedIterations > 0 && !s.generatorSaturated) {
              facts.push({ kind: "fail", text: "dropped " + s.droppedIterations + " iters at " + s.targetRate + "/s (" + label + ")" });
            } else if (s.generatorSaturated) {
              facts.push({ kind: "warn", text: "ladder generator saturated at " + s.targetRate + "/s (" + label + ")" });
            }
            var usage = frontUsage(v, s.resources);
            var tipped = (s.droppedIterations && s.droppedIterations > 0) || (s.resources && s.resources.oomKills > 0);
            if (tipped || (usage && usage.maxCpuPctOfEnv >= 90)) {
              var fact = resourceFact(v, s.resources, "tipped at " + s.targetRate + "/s (" + label + ")");
              if (fact) facts.push(fact);
            }
          });
        }
        prevLabel = label;
      });
      var tr = el("tr");
      var first = el("td", null, id); first.style.textAlign = "left"; tr.appendChild(first);
      var cell = el("td"); cell.style.textAlign = "left";
      if (!facts.length) cell.textContent = "no tip-over facts";
      else facts.forEach(function (f) { cell.appendChild(el("span", "badge " + (f.kind === "fail" ? "fail" : "warn"), f.text)); cell.appendChild(document.createTextNode(" ")); });
      tr.appendChild(cell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sec.appendChild(table);
    return sec;
  }

  function renderCompare() {
    document.title = "Results — compare";
    provEl.textContent = "";
    bodyEl.textContent = "";
    buildCompareNav();
    var cols = compareLevels();
    if (!cols.length) { bodyEl.appendChild(el("p", "note", "Select one or more runs to compare (one per load level recommended).")); return; }
    bodyEl.appendChild(honestyStrip(cols));
    bodyEl.appendChild(compareInputs(cols));
    bodyEl.appendChild(compareGrid(cols));
    bodyEl.appendChild(scalingChart(cols));
    bodyEl.appendChild(tipOverSection(cols));
  }

  function buildCompareNav() {
    compareNav.textContent = "";
    var controls = el("div", "compare-controls");
    var mlabel = el("label", null, "metric ");
    var msel = el("select", null, null);
    Object.keys(METRICS).forEach(function (key) {
      var opt = el("option", null, METRICS[key].label); opt.value = key;
      if (state.metric === key) opt.selected = true;
      msel.appendChild(opt);
    });
    msel.addEventListener("change", function () { state.metric = msel.value; pushHash(); render(); });
    controls.appendChild(mlabel); controls.appendChild(msel);
    var selBtn = el("button", null, "one per level"); selBtn.type = "button";
    selBtn.addEventListener("click", function () { state.compareIds = defaultCompareIds(); pushHash(); render(); });
    controls.appendChild(selBtn);
    var clearBtn = el("button", null, "clear"); clearBtn.type = "button";
    clearBtn.addEventListener("click", function () { state.compareIds = []; pushHash(); render(); });
    controls.appendChild(clearBtn);
    compareNav.appendChild(controls);
    var list = el("div", "run-checks");
    runs.forEach(function (run) {
      var label = el("label", "run-check");
      var cb = el("input", null, null); cb.type = "checkbox"; cb.checked = state.compareIds.indexOf(run.runId) >= 0;
      cb.addEventListener("change", function () {
        if (cb.checked) { if (state.compareIds.indexOf(run.runId) < 0) state.compareIds.push(run.runId); }
        else state.compareIds = state.compareIds.filter(function (id) { return id !== run.runId; });
        pushHash(); render();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(compareLabel(run)));
      list.appendChild(label);
    });
    compareNav.appendChild(list);
  }

  function syncModeChrome() {
    if (modeRunBtn) modeRunBtn.className = state.mode === "run" ? "active" : "";
    if (modeCompareBtn) modeCompareBtn.className = state.mode === "compare" ? "active" : "";
    if (runNav) runNav.hidden = state.mode !== "run";
    if (compareNav) compareNav.hidden = state.mode !== "compare";
  }
  function setMode(mode) {
    state.mode = mode;
    state.cohort = "all";
    if (mode === "compare" && state.compareIds.length === 0) state.compareIds = defaultCompareIds();
    syncModeChrome();
    pushHash();
    render();
  }

  // --- on-the-fly data (runs-data.json / runs-data.js) ----------------------
  // The shell carries no run data; it fetches the sibling runs-data.json at
  // runtime. file:// pages cannot fetch, so opening the page straight from
  // disk falls back to the sibling runs-data.js, which a script tag can load.
  function optionLabel(run) {
    var name = run.configName || "unknown-config";
    var flag = run.incomplete ? " · incomplete" : "";
    return name + " — " + run.runId + " (" + run.okCount + "/" + run.totalCount + " ok)" + flag;
  }
  function populateSelect() {
    if (!select) return;
    select.textContent = "";
    runs.forEach(function (run) {
      var opt = el("option", null, optionLabel(run));
      opt.value = run.runId;
      select.appendChild(opt);
    });
  }
  function init() {
    var parsed = parseHash(location.hash);
    if (parsed.mode === "compare" && parsed.runIds.length) {
      state.mode = "compare";
      state.metric = parsed.metric;
      state.compareIds = parsed.runIds.filter(function (id) { return byId[id]; });
      syncModeChrome();
      render();
      return;
    }
    var runId = parsed.runId && byId[parsed.runId] ? parsed.runId : null;
    if (!runId) { try { var stored = localStorage.getItem(STORAGE_KEY); if (stored && byId[stored]) runId = stored; } catch (e) {} }
    if (!runId) runId = runs.length ? runs[0].runId : null;
    selectRun(runId, false);
  }
  function boot(payload) {
    runs = (payload && payload.runs) || [];
    levels = (payload && payload.levels) || [];
    byId = {};
    for (var i = 0; i < runs.length; i++) byId[runs[i].runId] = runs[i];
    if (loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
    populateSelect();
    booted = true;
    init();
  }
  function loadError(err) {
    if (loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
    bodyEl.textContent = "";
    var box = el("details", "error");
    box.open = true;
    box.appendChild(el("summary", null, "Could not load runs-data.json"));
    var pre = el("pre");
    pre.textContent = String(err && err.message ? err.message : err);
    box.appendChild(pre);
    var note = el("p", "note");
    note.textContent = "The page loads results on the fly from the sibling runs-data.json, falling back to the sibling runs-data.js when fetch is blocked (file://). Keep all three files in the same folder; regenerate them with pnpm report:all if the data files are missing.";
    bodyEl.appendChild(box);
    bodyEl.appendChild(note);
  }

  if (select) select.addEventListener("change", function () { selectRun(select.value, true); });
  if (prevBtn) prevBtn.addEventListener("click", function () { step(-1); });
  if (nextBtn) nextBtn.addEventListener("click", function () { step(1); });
  if (modeRunBtn) modeRunBtn.addEventListener("click", function () { setMode("run"); });
  if (modeCompareBtn) modeCompareBtn.addEventListener("click", function () { setMode("compare"); });
  window.addEventListener("hashchange", function () {
    if (!booted) return;
    var parsed = parseHash(location.hash);
    if (parsed.mode === "compare") {
      state.mode = "compare";
      state.compareIds = parsed.runIds.filter(function (id) { return byId[id]; });
      state.metric = parsed.metric;
      syncModeChrome(); render();
    } else if (parsed.runId && byId[parsed.runId] && parsed.runId !== state.runId) {
      selectRun(parsed.runId, false);
    }
  });

  // fetch first (fresh data when served over HTTP); when fetch is blocked or
  // fails, fall back to the sibling runs-data.js, which a script tag can load
  // even from file://. Only if both fail does the page explain itself.
  function loadViaScriptFallback(cause) {
    var s = document.createElement("script");
    s.src = "runs-data.js";
    s.onload = function () {
      if (window.__RUNS_DATA__) { boot(window.__RUNS_DATA__); return; }
      loadError(new Error(String(cause) + " — runs-data.js did not define window.__RUNS_DATA__"));
    };
    s.onerror = function () {
      loadError(new Error(String(cause) + " — and the runs-data.js fallback did not load"));
    };
    document.head.appendChild(s);
  }
  fetch("runs-data.json", { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " " + res.statusText);
      return res.json();
    })
    .then(boot, loadViaScriptFallback);
})();`;

const VIEWER_STYLE = `
 body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;color:#1e293b}
 header.topbar{padding:16px 24px;border-bottom:1px solid #e2e8f0;background:#f8fafc;position:sticky;top:0;z-index:5}
 h1{font-size:16px;margin:0 0 8px}
 .run-nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
 .run-nav label{color:#64748b}
 select{font:inherit;padding:4px 8px;max-width:60ch}
 .run-nav button{font:inherit;padding:4px 10px;cursor:pointer}
 .provenance{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
 .chip{background:#eef2ff;color:#3730a3;border-radius:999px;padding:2px 8px;font-size:12px}
 .chips{display:flex;gap:6px;flex-wrap:wrap;margin:16px 24px 8px}
 .chip-btn{font:inherit;font-size:12px;border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:3px 10px;cursor:pointer}
 .chip-btn.active{background:#1e293b;color:#fff;border-color:#1e293b}
 main{padding:0 24px 48px}
 section{margin:20px 0}
 h2{font-size:14px;margin:0 0 2px}
 h3{font-size:12px;margin:0 0 6px;color:#475569;text-transform:uppercase;letter-spacing:.04em}
 h4{font-size:12px;margin:8px 0 4px;color:#475569}
 .sub{color:#64748b;margin:0 0 8px;font-size:12px}
 .note{color:#64748b;font-style:italic}
 .note.not-requested{background:#fffbeb;border:1px solid #fde68a;border-radius:4px;padding:6px 10px;color:#92400e;font-style:normal}
 .note.not-requested code{background:#fef3c7;padding:1px 5px;border-radius:3px;font-style:normal}
 .title-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
 .mode-toggle{display:flex;gap:0;border:1px solid #cbd5e1;border-radius:6px;overflow:hidden}
 .mode-toggle button{font:inherit;padding:4px 12px;border:0;background:#fff;cursor:pointer}
 .mode-toggle button.active{background:#1e293b;color:#fff}
 .compare-nav{margin-top:10px}
 .compare-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
 .compare-controls button{font:inherit;font-size:12px;padding:3px 10px;cursor:pointer}
 .run-checks{display:flex;gap:10px;flex-wrap:wrap;max-height:120px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px;padding:8px;background:#fff}
 .run-check{font-size:12px;white-space:nowrap}
 .honesty{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 24px 8px;color:#92400e}
 table.matrix.compare td.rowlabel{color:#64748b;font-weight:600}
 td.diff{background:#fff7ed}
 .chart{width:100%;max-width:820px;height:auto;margin:6px 0}
 .chart .axis{stroke:#cbd5e1;stroke-width:1}
 .chart .gridline{stroke:#eef2f7;stroke-width:1}
 .chart .tick{fill:#64748b;font-size:10px}
 .chart-empty{color:#94a3b8}
 .legend-inline{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0}
 .legend-item{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#334155}
 button.legend-item{font:inherit;font-size:11px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:1px 6px;cursor:pointer}
 button.legend-item.off{opacity:.4;text-decoration:line-through}
 .swatch{display:inline-block;width:10px;height:10px;border-radius:2px}
 .thresholds{display:inline-flex;gap:4px;flex-wrap:wrap}
 table{border-collapse:collapse;font-size:12px}
 table.matrix th,table.matrix td{border:1px solid #e2e8f0;padding:4px 8px;text-align:right;white-space:nowrap}
 table.matrix th{background:#f8fafc;text-align:center;position:sticky;top:0;cursor:pointer;user-select:none}
 table.matrix td:nth-child(-n+2){text-align:left}
 table.matrix th.sort-asc::after{content:" ▲"}
 table.matrix th.sort-desc::after{content:" ▼"}
 td.leader{font-weight:700;background:#f0fdf4}
 td.empty{color:#94a3b8;font-style:italic;text-align:center}
 .status-cell{display:inline-flex;align-items:center;gap:6px}
 details.error{display:inline-block}
 details.error>summary{cursor:pointer;color:#b91c1c}
 details.error pre{white-space:pre-wrap;max-width:60ch;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;padding:6px;margin:6px 0 0;text-align:left;font-size:11px}
 .badge{display:inline-block;border-radius:4px;padding:1px 6px;font-weight:600;font-size:11px}
 .badge.pass{color:#15803d;background:#dcfce7}
 .badge.fail{color:#b91c1c;background:#fee2e2}
 .badge.warn{color:#92400e;background:#fef3c7}
 details.inputs{margin:16px 0}
 details.inputs>summary{cursor:pointer;font-weight:600;color:#334155}
 .input-grid{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
 .card{border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;min-width:220px}
 .card.wide{flex-basis:100%}
 .scenario{margin-bottom:8px}
 table.kv{border-collapse:collapse;font-size:12px}
 table.kv th{text-align:left;color:#64748b;font-weight:400;padding:1px 10px 1px 0;vertical-align:top}
 table.kv td{padding:1px 0}
 footer.legend{padding:16px 24px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0}
`;

/**
 * The on-the-fly data payload (`results/runs-data.json`), fetched by the shell
 * at runtime. Same trimmed shape the page used to inline: p50s and folded
 * per-leg views only — never raw sample arrays, capture bodies or logs.
 */
export function renderViewerData(runs: RunView[]): string {
  return safeJson({ runs, levels: deriveLoadLevels(runs) });
}

/**
 * The same payload as `renderViewerData`, wrapped as a JS assignment
 * (`results/runs-data.js`). A script tag can load a sibling file from `file://`
 * too, so the shell falls back to this when `fetch` is blocked — i.e. when the
 * generated page is opened straight from disk.
 */
export function renderViewerDataJs(runs: RunView[]): string {
  return `window.__RUNS_DATA__ = ${renderViewerData(runs)};\n`;
}

/**
 * Render the viewer shell (`results/index.html`). The page contains only the
 * chrome, styles and rendering code — no run data. It fetches the sibling
 * `runs-data.json` at runtime, falling back to loading the sibling
 * `runs-data.js` via a script tag when `fetch` is blocked (`file://`), so the
 * generated page works both served over HTTP and opened straight from disk.
 */
export function renderViewerHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Architecture benchmark — results</title>
<style>${VIEWER_STYLE}</style>
</head>
<body>
<header class="topbar">
  <div class="title-row">
    <h1>Architecture benchmark — results</h1>
    <div class="mode-toggle">
      <button type="button" id="mode-run" class="active">Run view</button>
      <button type="button" id="mode-compare">Compare view</button>
    </div>
  </div>
  <div class="run-nav" id="run-nav">
    <label for="run-select">Run</label>
    <select id="run-select"></select>
    <button type="button" id="run-prev" title="newer run">‹</button>
    <button type="button" id="run-next" title="older run">›</button>
  </div>
  <div class="compare-nav" id="compare-nav" hidden></div>
  <div class="provenance" id="provenance"></div>
</header>
<main id="view-body"><p class="note" id="loading">Loading runs-data.json …</p></main>
<footer class="legend">
  Per-metric leaders are bolded; there is deliberately no composite score.
  Charts are views — the tables are the source of truth.
  Blank means not measured, never zero. A generator-saturated load trial is
  withheld — generator saturated. Performance figures are indicative single-host.
</footer>
<script>${VIEWER_SCRIPT}</script>
</body></html>
`;
}
