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
import type { StaticInventory } from "./inventory.js";
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
}

export interface VariantMutationView {
  perOp: Record<
    "create" | "update" | "delete",
    { count: number; rate: number } | null
  >;
  duration: {
    avg: number;
    med: number;
    p90: number;
    p95: number;
    p99: number;
    max: number;
  } | null;
  failures: number | null;
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
  correctness: "pass" | "fail" | null;
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
  variants: VariantView[];
}

// ---------------------------------------------------------------------------
// Raw artefact shapes (trimmed locally — never re-exported raw)

interface PreflightFile {
  runId?: string;
  gitRevision?: string;
  config?: string;
  effectiveManifestSha256?: string;
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
  pages?: Record<
    string,
    Array<{ ttfb: number; fcp: number; lcp: number; firstData: number }>
  >;
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
}

interface K6Metric {
  count?: number;
  rate?: number;
  avg?: number;
  med?: number;
  min?: number;
  max?: number;
  fails?: number;
  "p(90)"?: number;
  "p(95)"?: number;
  "p(99)"?: number;
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
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `2026-10-09t17-44-06-935z` → `2026-10-09T17:44:06.935Z`. */
export function parseRunId(runId: string): string | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})[tT](\d{2})-(\d{2})-(\d{2})-(\d{3})[zZ]$/.exec(runId);
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

const p50 = (values: number[] | undefined): number | null =>
  values && values.length > 0 ? percentile(values, 50) : null;

const positive = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

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
  return {
    vus: report.vus ?? 0,
    requests: report.requests ?? 0,
    // A generator-saturated trial is an invalid app measurement: withhold the
    // numbers (keep the flag so the UI can say why) — plan §2/§4.3/§6.5.
    opsPerSecond: generatorSaturated
      ? null
      : positive(report.opsPerSecond ?? null),
    p95Ms: generatorSaturated ? null : positive(report.p95Ms ?? null),
    failedRate: report.failedRate ?? 0,
    generatorSaturated,
    pgStatementsDelta: report.pgStatements?.delta ?? null,
  };
}

function reduceMutations(
  report: MutationsSummaryFile | null,
): VariantMutationView | null {
  const metrics = report?.metrics;
  if (!metrics) return null;
  const perOpOf = (
    kind: "create" | "update" | "delete",
  ): { count: number; rate: number } | null => {
    const metric = metrics[`mk_${kind}_ok`];
    return metric &&
      typeof metric.count === "number" &&
      typeof metric.rate === "number"
      ? { count: metric.count, rate: metric.rate }
      : null;
  };
  const raw = metrics.http_req_duration;
  const duration =
    raw &&
    typeof raw.avg === "number" &&
    typeof raw.med === "number" &&
    typeof raw["p(90)"] === "number" &&
    typeof raw["p(95)"] === "number" &&
    typeof raw["p(99)"] === "number" &&
    typeof raw.max === "number"
      ? {
          avg: raw.avg,
          med: raw.med,
          p90: raw["p(90)"],
          p95: raw["p(95)"],
          p99: raw["p(99)"],
          max: raw.max,
        }
      : null;
  return {
    perOp: {
      create: perOpOf("create"),
      update: perOpOf("update"),
      delete: perOpOf("delete"),
    },
    duration,
    failures:
      typeof metrics.http_req_failed?.fails === "number"
        ? metrics.http_req_failed.fails
        : null,
  };
}

function inventoryOf(
  raw: StaticInventory | undefined,
): VariantInventoryView | null {
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
    render: reduceRender(
      readJson<RenderFile>(path.join(variantDir, "render.json")),
    ),
    load: reduceLoad(readJson<LoadFile>(path.join(variantDir, "load.json"))),
    mutations: reduceMutations(
      readJson<MutationsSummaryFile>(
        path.join(variantDir, "mutations-summary.json"),
      ),
    ),
    correctness: correctness ? (correctness.ok ? "pass" : "fail") : null,
    // Deliberately never read: mutations.json (raw samples), capture.json
    // (contains request bodies), *.log, lifecycle.json (docker stdout).
  };
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
  const variants = results.map((result) =>
    buildVariant(result, runDir, inventory, manifests),
  );
  // Stable across runs (cohort, then id) so two runs are easy to eyeball.
  variants.sort((a, b) =>
    a.cohort === b.cohort
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.cohort < b.cohort
        ? -1
        : 1,
  );
  return {
    runId,
    incomplete: !summary || results.length === 0,
    configName: typeof effective?.name === "string" ? effective.name : null,
    configFile: preflight?.config ?? null,
    gitRevision: preflight?.gitRevision ?? null,
    effectiveManifestSha256:
      summary?.effectiveManifestSha256 ??
      preflight?.effectiveManifestSha256 ??
      null,
    startedAt: parseRunId(runId),
    okCount: results.filter((r) => r.status === "ok").length,
    totalCount: results.length,
    inputs: effective,
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
    const preflight = readJson<PreflightFile>(
      path.join(runDir, "preflight.json"),
    );
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
// HTML (plan §4.2/§4.3)

const esc = (value: unknown): string =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** JSON safe to inline in a `<script>` element: no `<`, `>`, `&`, U+2028/9. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function optionLabel(run: RunView): string {
  const name = run.configName ?? "unknown-config";
  const flag = run.incomplete ? " · incomplete" : "";
  return `${name} — ${run.runId} (${run.okCount}/${run.totalCount} ok)${flag}`;
}

const VIEWER_SCRIPT = `(function () {
  "use strict";
  var dataEl = document.getElementById("runs-data");
  var runs = [];
  try { runs = JSON.parse(dataEl.textContent) || []; } catch (e) { runs = []; }
  var byId = {};
  for (var i = 0; i < runs.length; i++) byId[runs[i].runId] = runs[i];

  var select = document.getElementById("run-select");
  var prevBtn = document.getElementById("run-prev");
  var nextBtn = document.getElementById("run-next");
  var provEl = document.getElementById("provenance");
  var bodyEl = document.getElementById("view-body");
  var STORAGE_KEY = "bench-results-run";
  var state = { runId: null, cohort: "all", sort: {} };

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

  function sectionTable(sectionId, title, subtitle, columns, rows, hasData) {
    var sec = el("section");
    sec.appendChild(el("h2", null, title));
    if (subtitle) sec.appendChild(el("p", "sub", subtitle));
    if (!hasData) sec.appendChild(el("p", "note", "— not measured in this run."));
    else sec.appendChild(renderTable(sectionId, columns, rows));
    return sec;
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
    cols.push(col("deps", "direct deps", function (v) { return v.inventory ? v.inventory.directDependencies : null; }, fmtInt, { numeric: true, lower: true, title: "direct dependencies (lower is better)" }));
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
      if (s.kind === "capacity") block.appendChild(el("p", "note", "capacity ladder declared; not yet executed by the rig (R8)."));
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
      runCard.appendChild(kvTable([["trials", inp.trials], ["variantOrder", inp.variantOrder], ["variants", inp.variants ? inp.variants.length : undefined]]));
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
    bodyEl.appendChild(sectionTable("Correctness", "Correctness", "black-box suite result (needs --with-correctness)", idCols().concat([correctnessColumn()]), run.variants, anyCorrectness));

    var anyRender = run.variants.some(function (v) { return v.render !== null; });
    bodyEl.appendChild(sectionTable("Render", "Render", "p50 of raw samples — indicative single-host (needs --with-render)", renderColumns(run), run.variants, anyRender));

    var anyLoad = run.variants.some(function (v) { return v.load !== null; });
    bodyEl.appendChild(sectionTable("Load-read", "Load — read-only capacity", "k6 read leg; a generator-saturated trial is withheld (needs --with-load)", loadReadColumns(), run.variants, anyLoad));

    var anyMutations = run.variants.some(function (v) { return v.mutations !== null; });
    bodyEl.appendChild(sectionTable("Load-mutations", "Load — mutation volume", "k6 volume leg; per-op rate + latency percentiles (needs --with-load)", mutationColumns(), run.variants, anyMutations));

    var anyInventory = run.variants.some(function (v) { return v.inventory !== null; });
    bodyEl.appendChild(sectionTable("Static", "Static & complexity", "authored source vs on-disk footprint; bytes human-readable (exact in title)", staticColumns(), run.variants, anyInventory));
  }

  function selectRun(runId, push) {
    if (!byId[runId]) runId = runs.length ? runs[0].runId : null;
    state.runId = runId;
    state.cohort = "all";
    if (select && select.value !== runId && runId) select.value = runId;
    if (push && runId) { try { location.hash = runId; } catch (e) {} }
    try { if (runId) localStorage.setItem(STORAGE_KEY, runId); } catch (e) {}
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
  function initialRunId() {
    var hash = (location.hash || "").replace(/^#/, "");
    if (hash && byId[hash]) return hash;
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored && byId[stored]) return stored;
    } catch (e) {}
    return runs.length ? runs[0].runId : null;
  }

  if (select) select.addEventListener("change", function () { selectRun(select.value, true); });
  if (prevBtn) prevBtn.addEventListener("click", function () { step(-1); });
  if (nextBtn) nextBtn.addEventListener("click", function () { step(1); });
  window.addEventListener("hashchange", function () {
    var hash = (location.hash || "").replace(/^#/, "");
    if (byId[hash] && hash !== state.runId) selectRun(hash, false);
  });
  selectRun(initialRunId(), false);
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
 * Render the single self-contained results page. All data is inline (a
 * `file://` page cannot `fetch()` local JSON), there is no external script or
 * stylesheet, and every dynamic string is escaped or rendered via `textContent`.
 */
export function renderViewerHtml(runs: RunView[]): string {
  const options = runs
    .map(
      (run) =>
        `<option value="${esc(run.runId)}">${esc(optionLabel(run))}</option>`,
    )
    .join("\n      ");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Architecture benchmark — results</title>
<style>${VIEWER_STYLE}</style>
</head>
<body>
<header class="topbar">
  <h1>Architecture benchmark — results</h1>
  <div class="run-nav">
    <label for="run-select">Run</label>
    <select id="run-select">
      ${options}
    </select>
    <button type="button" id="run-prev" title="newer run">‹</button>
    <button type="button" id="run-next" title="older run">›</button>
  </div>
  <div class="provenance" id="provenance"></div>
</header>
<main id="view-body"></main>
<footer class="legend">
  Per-metric leaders are bolded; there is deliberately no composite score.
  Blank means not measured, never zero. A generator-saturated load trial is
  withheld — generator saturated. Performance figures are indicative single-host.
</footer>
<script type="application/json" id="runs-data">${safeJson(runs)}</script>
<script>${VIEWER_SCRIPT}</script>
</body></html>
`;
}
