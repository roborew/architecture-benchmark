// Decision-matrix generation (plan §6.6). A report is a reproducible *view*
// over the raw run artefacts (`summary.json`, `inventory.json`, the manifests,
// `effective-config.yaml`) — never the only copy of the results.
//
// Columns are grouped 6.1–6.5. Columns whose data source has not run yet
// (browser correctness/render, k6 load) are present but empty and explicitly
// labelled, so the matrix shape is stable as the suites land. There is no
// composite "best" column (live.md: the decision matrix comes first).

import { readFileSync } from "node:fs";
import path from "node:path";
import type { VariantManifest } from "../config/schema.js";
import type { StaticInventory } from "./inventory.js";

export interface StageSummary {
  ok: boolean;
  ms: number;
}

export interface VariantResultRow {
  id: string;
  cohort: string;
  status: string;
  performanceEligible: boolean;
  ports: Record<string, number>;
  stages: Record<string, StageSummary>;
  error: string | null;
}

export interface RunSummary {
  runId: string;
  effectiveManifestSha256: string;
  results: VariantResultRow[];
}

export interface MatrixRow {
  variant: string;
  cohort: string;
  orm: string;
  readMode: string;
  mutationMode: string;
  gate: string;
  buildMs: number | null;
  seedMs: number | null;
  verifyMs: number | null;
  upMs: number | null;
  sourceFiles: number | null;
  sourceLoc: number | null;
  sourceBytes: number | null;
  testFiles: number | null;
  testLoc: number | null;
  infraFiles: number | null;
  infraLoc: number | null;
  directDeps: number | null;
  languages: number | null;
  services: number | null;
  images: number | null;
  /** Indicative single-host columns (plan §6.4/§6.5) — populated by R6/R7. */
  renderTtfbMs: null;
  renderFirstDataMs: null;
  loadOpsPerSecond: null;
  runSha256: string;
}

const COLUMNS: Array<{ key: keyof MatrixRow; header: string; group: string }> = [
  { key: "variant", header: "variant", group: "identity" },
  { key: "cohort", header: "cohort", group: "identity" },
  { key: "orm", header: "orm", group: "identity" },
  { key: "readMode", header: "read", group: "identity" },
  { key: "mutationMode", header: "mutation", group: "identity" },
  { key: "gate", header: "correctness", group: "6.3" },
  { key: "buildMs", header: "build_ms", group: "6.2" },
  { key: "upMs", header: "up_ms", group: "6.2" },
  { key: "seedMs", header: "seed_ms", group: "6.2" },
  { key: "verifyMs", header: "verify_ms", group: "6.2" },
  { key: "sourceFiles", header: "source_files", group: "6.1" },
  { key: "sourceLoc", header: "source_loc", group: "6.1" },
  { key: "sourceBytes", header: "source_bytes", group: "6.1" },
  { key: "testFiles", header: "test_files", group: "6.1" },
  { key: "testLoc", header: "test_loc", group: "6.1" },
  { key: "infraFiles", header: "infra_files", group: "6.1" },
  { key: "infraLoc", header: "infra_loc", group: "6.1" },
  { key: "directDeps", header: "direct_deps", group: "6.1" },
  { key: "languages", header: "languages", group: "6.1" },
  { key: "services", header: "services", group: "6.1" },
  { key: "images", header: "images", group: "6.1" },
  { key: "renderTtfbMs", header: "render_ttfb_ms", group: "6.4" },
  { key: "renderFirstDataMs", header: "render_first_data_ms", group: "6.4" },
  { key: "loadOpsPerSecond", header: "load_ops_per_sec", group: "6.5" },
  { key: "runSha256", header: "run_sha256", group: "provenance" },
];

export function matrixColumns(): Array<{ key: keyof MatrixRow; header: string; group: string }> {
  return COLUMNS;
}

const stageMs = (row: VariantResultRow, name: string): number | null =>
  row.stages[name]?.ok ? (row.stages[name]!.ms ?? null) : null;

export function buildMatrix(
  summary: RunSummary,
  inventory: Map<string, StaticInventory>,
  manifests: Map<string, VariantManifest>,
): MatrixRow[] {
  return summary.results.map((result) => {
    const manifest = manifests.get(result.id);
    const inv = inventory.get(result.id);
    return {
      variant: result.id,
      cohort: result.cohort,
      orm: manifest?.orm ?? "—",
      readMode: manifest?.readMode ?? "—",
      mutationMode: manifest?.mutationMode ?? "—",
      gate: result.status === "ok" ? "pass" : "fail",
      buildMs: stageMs(result, "build"),
      upMs: stageMs(result, "up"),
      seedMs: stageMs(result, "seed"),
      verifyMs: stageMs(result, "verifyDigest"),
      sourceFiles: inv?.source.files ?? null,
      sourceLoc: inv?.source.loc ?? null,
      sourceBytes: inv?.source.bytes ?? null,
      testFiles: inv?.tests.files ?? null,
      testLoc: inv?.tests.loc ?? null,
      infraFiles: inv?.infrastructure.files ?? null,
      infraLoc: inv?.infrastructure.loc ?? null,
      directDeps: inv?.directDependencies ?? null,
      languages: inv?.languages ?? null,
      services: inv?.serviceCount ?? null,
      images: inv?.imageCount ?? null,
      renderTtfbMs: null,
      renderFirstDataMs: null,
      loadOpsPerSecond: null,
      runSha256: summary.effectiveManifestSha256,
    };
  });
}

const cell = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: MatrixRow[]): string {
  const header = COLUMNS.map((c) => c.header).join(",");
  const body = rows.map((row) => COLUMNS.map((c) => csvEscape(cell(row[c.key]))).join(","));
  return `${[header, ...body].join("\n")}\n`;
}

export function toMarkdown(rows: MatrixRow[], meta: { runId: string; sha256: string }): string {
  const header = `| ${COLUMNS.map((c) => c.header).join(" | ")} |`;
  const divider = `| ${COLUMNS.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${COLUMNS.map((c) => cell(row[c.key])).join(" | ")} |`);
  return [
    `# Decision matrix — run \`${meta.runId}\``,
    "",
    `Effective-config sha256: \`${meta.sha256}\``,
    "",
    "Performance columns are *indicative single-host* (plan §6.6). Correctness,",
    "render and load columns are populated by plan R5–R7; blank means not yet",
    "measured, not zero.",
    "",
    header,
    divider,
    ...body,
    "",
  ].join("\n");
}

export function toHtml(rows: MatrixRow[], meta: { runId: string; sha256: string }): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const head = COLUMNS.map((c) => `<th title="group ${esc(c.group)}">${esc(c.header)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${COLUMNS.map((c) => {
          const value = row[c.key];
          const cls = c.key === "gate" ? ` class="gate-${esc(cell(value))}"` : "";
          return `<td${cls}>${esc(cell(value))}</td>`;
        }).join("")}</tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Decision matrix — ${esc(meta.runId)}</title>
<style>
 body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#1e293b}
 h1{font-size:18px} .meta{color:#64748b;margin-bottom:16px}
 table{border-collapse:collapse;font-size:12px}
 th,td{border:1px solid #e2e8f0;padding:4px 8px;text-align:right;white-space:nowrap}
 th{background:#f8fafc;text-align:center;position:sticky;top:0}
 td:nth-child(-n+6){text-align:left}
 .gate-pass{color:#15803d;font-weight:600}.gate-fail{color:#b91c1c;font-weight:600}
 caption{text-align:left;color:#64748b;margin-bottom:8px}
</style></head>
<body>
<h1>Decision matrix</h1>
<div class="meta">run <code>${esc(meta.runId)}</code> · effective-config sha256 <code>${esc(meta.sha256)}</code><br>
Performance columns are indicative single-host (plan §6.6). Blank cells are not-yet-measured (R5–R7), not zero.</div>
<table><caption>${rows.length} variant(s)</caption>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody></table>
</body></html>
`;
}

/** Load the raw artefacts of a run directory. */
export function loadRun(runDir: string): { summary: RunSummary; inventory: Map<string, StaticInventory> } {
  const summary = JSON.parse(readFileSync(path.join(runDir, "summary.json"), "utf8")) as RunSummary;
  let inventory = new Map<string, StaticInventory>();
  try {
    const raw = JSON.parse(readFileSync(path.join(runDir, "inventory.json"), "utf8")) as StaticInventory[];
    inventory = new Map(raw.map((entry) => [entry.variantId, entry]));
  } catch {
    // inventory.json is optional; the report simply shows blank inventory cells.
  }
  return { summary, inventory };
}
