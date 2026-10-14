import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VariantManifest } from "../src/config/schema.js";
import {
  buildRunsIndex,
  deriveLoadLevels,
  formatCompareHash,
  parseCompareHash,
  parseRunId,
  renderViewerData,
  renderViewerHtml,
  type RunView,
} from "../src/reporting/viewer.js";

// A Docker-free test over a synthesised `results/` tree (plan §3.3).

const manifests = new Map<string, VariantManifest>([
  [
    "next-actions",
    {
      orm: "none",
      readMode: "server-rendered",
      mutationMode: "server-actions",
    } as unknown as VariantManifest,
  ],
  [
    "tanstack-express-rest",
    {
      orm: "drizzle",
      readMode: "rest",
      mutationMode: "rest",
    } as unknown as VariantManifest,
  ],
]);

function write(root: string, relative: string, contents: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

const summaryResult = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "next-actions",
  cohort: "next-fullstack",
  status: "ok",
  performanceEligible: true,
  stages: {
    build: { ok: true, ms: 10 },
    seed: { ok: true, ms: 20 },
    correctness: { ok: true, ms: 5 },
  },
  error: null,
  ...overrides,
});

function makeResultsRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "bench-viewer-"));

  // (a) A complete run with render/load/mutations + a saturated load trial.
  const complete = "2026-10-09t17-44-06-935z";
  write(
    root,
    path.join(complete, "preflight.json"),
    JSON.stringify({
      runId: complete,
      gitRevision: "dfdedd53273fa68781bc4c29e324dcbeb64ee9bb",
      config: "config/smoke-matrix.yaml",
      effectiveManifestSha256: "fbc138ee",
    }),
  );
  write(
    root,
    path.join(complete, "effective-config.yaml"),
    [
      "schemaVersion: 1",
      "name: smoke-matrix",
      "trials: 1",
      "variantOrder: rotate",
      "variants: [next-actions, tanstack-express-rest]",
      "fixture:",
      "  projectCount: 5",
      "  userCount: 20",
      "  taskCount: 1000",
      "  commentCount: 1000",
      "scenarios:",
      "  - id: volume-50-writes",
      "    kind: volume",
      "    counts: { list: 100, create: 50 }",
      "",
    ].join("\n"),
  );
  write(
    root,
    path.join(complete, "summary.json"),
    JSON.stringify({
      runId: complete,
      effectiveManifestSha256: "fbc138ee",
      results: [
        summaryResult(),
        summaryResult({
          id: "tanstack-express-rest",
          cohort: "spa-api",
          status: "failed",
          performanceEligible: false,
          stages: { build: { ok: true, ms: 11 } },
          error: '<bad> & "</script>',
        }),
      ],
    }),
  );
  write(
    root,
    path.join(complete, "inventory.json"),
    JSON.stringify([
      {
        variantId: "next-actions",
        source: { files: 10, loc: 100, bytes: 1000 },
        tests: { files: 5, loc: 50, bytes: 500 },
        infrastructure: { files: 2, loc: 20, bytes: 200 },
        directDependencies: 5,
        languages: 3,
        serviceCount: 3,
        imageCount: 3,
      },
    ]),
  );
  write(
    root,
    path.join(complete, "variants", "next-actions", "render.json"),
    JSON.stringify({
      variant: "next-actions",
      pages: {
        board: [
          { ttfb: 10, fcp: 40, lcp: 60, firstData: 80 },
          { ttfb: 20, fcp: 50, lcp: 70, firstData: 90 },
          { ttfb: 30, fcp: 60, lcp: 80, firstData: 100 },
        ],
      },
      interactions: { create: [100, 200, 300] },
    }),
  );
  write(
    root,
    path.join(complete, "variants", "next-actions", "load.json"),
    JSON.stringify({
      vus: 4,
      requests: 2376,
      opsPerSecond: 157.9,
      p95Ms: 47.9,
      failedRate: 0,
      generatorSaturated: true,
      paths: {
        "/projects": { p50Ms: 12.3, p95Ms: 30.1 },
        "/tasks/1": { p50Ms: 9, p95Ms: 22 },
      },
      thresholds: [
        { metric: "http_req_failed", expression: "rate<0.01", ok: true },
        { metric: "http_req_duration", expression: "p(95)<800", ok: false },
      ],
      resources: {
        source: "api",
        services: {
          app: {
            maxCpuPctOfEnv: 99,
            avgCpuPctOfEnv: 70,
            maxMemMb: 300,
            maxMemPctOfEnv: 41,
          },
        },
        oomKills: 0,
      },
      pgStatements: { before: 1, after: 2, delta: 1 },
    }),
  );
  write(
    root,
    path.join(complete, "variants", "next-actions", "mutations-summary.json"),
    JSON.stringify({
      root_group: { id: "unused" },
      metrics: {
        http_req_duration: {
          avg: 100,
          med: 90,
          min: 5,
          max: 140,
          "p(90)": 110,
          "p(95)": 120,
          "p(99)": 130,
          thresholds: { "p(95)<1500": { ok: true } },
        },
        http_req_failed: { fails: 2, passes: 148 },
        mk_create_ok: { count: 50, rate: 5 },
        mk_update_ok: { count: 50, rate: 5 },
        mk_delete_ok: { count: 50, rate: 5 },
      },
    }),
  );
  write(
    root,
    path.join(complete, "variants", "next-actions", "capacity.json"),
    JSON.stringify({
      applicable: true,
      mixed: true,
      scenarioId: "capacity-medium-mixed",
      durationPerStepSeconds: 60,
      ratesPerSecond: [10, 20],
      steps: [
        {
          targetRate: 20,
          achievedPerSecond: 19.8,
          p95Ms: 60,
          p99Ms: 90,
          failedRate: 0,
          droppedIterations: 0,
          vusMax: 30,
          generatorSaturated: false,
          thresholds: [
            { metric: "http_req_failed", expression: "rate<0.01", ok: true },
          ],
          resources: {
            source: "api",
            services: {
              app: { maxCpuPctOfEnv: 99, maxMemPctOfEnv: 41 },
            },
            oomKills: 0,
          },
        },
        {
          targetRate: 10,
          achievedPerSecond: 10,
          p95Ms: 40,
          p99Ms: 55,
          failedRate: 0,
          droppedIterations: 0,
          vusMax: 20,
          generatorSaturated: false,
          thresholds: [],
        },
      ],
    }),
  );
  // Raw artefacts that must never be embedded.
  write(
    root,
    path.join(complete, "variants", "next-actions", "mutations.json"),
    JSON.stringify([{ metric: "raw-sample" }]),
  );
  write(
    root,
    path.join(complete, "variants", "next-actions", "capture.json"),
    JSON.stringify({ body: "capture-secret-body" }),
  );
  // The raw 1 Hz resource series — reduced to a timeline, never embedded raw.
  write(
    root,
    path.join(
      complete,
      "variants",
      "next-actions",
      "resources",
      "read-samples.json",
    ),
    JSON.stringify({
      source: "api",
      intervalMs: 1000,
      samples: [
        {
          t: 0,
          service: "app",
          cores: 0.5,
          cpuPctOfEnv: 25,
          memWorkingSetMb: 100,
          memPctOfEnv: 5,
        },
        {
          t: 1000,
          service: "app",
          cores: 1,
          cpuPctOfEnv: 50,
          memWorkingSetMb: 200,
          memPctOfEnv: 10,
        },
        {
          t: 1000,
          service: "db",
          cores: 0.1,
          cpuPctOfEnv: 5,
          memWorkingSetMb: 50,
          memPctOfEnv: 5,
        },
      ],
    }),
  );

  // (b) A run with no render/load/mutation artefacts (no --with-* flags).
  const noArtefacts = "2026-10-09t15-00-00-000z";
  write(
    root,
    path.join(noArtefacts, "preflight.json"),
    JSON.stringify({
      runId: noArtefacts,
      gitRevision: "abc",
      config: "config/default.yaml",
    }),
  );
  write(
    root,
    path.join(noArtefacts, "summary.json"),
    JSON.stringify({
      runId: noArtefacts,
      effectiveManifestSha256: "deadbeef",
      results: [summaryResult({ stages: { build: { ok: true, ms: 9 } } })],
    }),
  );

  // (c) An aborted run: a summary that recorded zero variants.
  const aborted = "2026-10-10t14-37-05-971z";
  write(
    root,
    path.join(aborted, "summary.json"),
    JSON.stringify({
      runId: aborted,
      effectiveManifestSha256: "cafe",
      results: [],
    }),
  );

  // (d) A run dir with preflight + effective config but no summary.
  const preflightOnly = "2026-10-08t10-00-00-000z";
  write(
    root,
    path.join(preflightOnly, "preflight.json"),
    JSON.stringify({ runId: preflightOnly, config: "config/default.yaml" }),
  );
  write(
    root,
    path.join(preflightOnly, "effective-config.yaml"),
    "schemaVersion: 1\nname: default\n",
  );

  // (e) Junk: a directory that is not a run.
  mkdirSync(path.join(root, "junk"), { recursive: true });
  writeFileSync(path.join(root, "junk", "readme.txt"), "not a run\n");

  return root;
}

describe("parseRunId", () => {
  it("parses the ISO-timestamp run id back to a timestamp", () => {
    expect(parseRunId("2026-10-09t17-44-06-935z")).toBe(
      "2026-10-09T17:44:06.935Z",
    );
    expect(parseRunId("2026-10-09T11-49-44-744Z")).toBe(
      "2026-10-09T11:49:44.744Z",
    );
    expect(parseRunId("not-a-run")).toBeNull();
  });
});

describe("buildRunsIndex", () => {
  it("discovers runs newest-first and ignores junk", () => {
    const root = makeResultsRoot();
    try {
      const runs = buildRunsIndex(root, manifests);
      expect(runs.map((r) => r.runId)).toEqual([
        "2026-10-10t14-37-05-971z",
        "2026-10-09t17-44-06-935z",
        "2026-10-09t15-00-00-000z",
        "2026-10-08t10-00-00-000z",
      ]);
      // Variants are ordered cohort-then-id, stable across runs.
      for (const run of runs) {
        const cohorts = run.variants.map((v) => v.cohort);
        expect(cohorts).toEqual([...cohorts].sort());
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags incomplete runs and counts ok/total variants", () => {
    const root = makeResultsRoot();
    try {
      const byId = new Map(
        buildRunsIndex(root, manifests).map((r) => [r.runId, r]),
      );
      const complete = byId.get("2026-10-09t17-44-06-935z")!;
      expect(complete.incomplete).toBe(false);
      expect(complete.okCount).toBe(1);
      expect(complete.totalCount).toBe(2);
      expect(complete.configName).toBe("smoke-matrix");
      expect(complete.configFile).toBe("config/smoke-matrix.yaml");
      expect(complete.startedAt).toBe("2026-10-09T17:44:06.935Z");

      expect(byId.get("2026-10-10t14-37-05-971z")!.incomplete).toBe(true);
      expect(byId.get("2026-10-08t10-00-00-000z")!.incomplete).toBe(true);
      expect(byId.get("2026-10-09t15-00-00-000z")!.incomplete).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reduces render samples to p50s and never keeps raw arrays", () => {
    const root = makeResultsRoot();
    try {
      const run = buildRunsIndex(root, manifests).find(
        (r) => r.runId === "2026-10-09t17-44-06-935z",
      )!;
      const next = run.variants.find((v) => v.id === "next-actions")!;
      expect(next.orm).toBe("none");
      expect(next.render!.pages.board!.ttfb).toBe(20);
      expect(next.render!.pages.board!.fcp).toBe(50);
      expect(next.render!.pages.board!.lcp).toBe(70);
      expect(next.render!.pages.board!.firstData).toBe(90);
      expect(next.render!.interactions.create).toBe(200);

      // A variant with no render artefact keeps a null section.
      const other = run.variants.find((v) => v.id === "tanstack-express-rest")!;
      expect(other.render).toBeNull();
      expect(other.load).toBeNull();
      expect(other.mutations).toBeNull();
      expect(other.correctness).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("withholds a generator-saturated load trial", () => {
    const root = makeResultsRoot();
    try {
      const run = buildRunsIndex(root, manifests).find(
        (r) => r.runId === "2026-10-09t17-44-06-935z",
      )!;
      const load = run.variants.find((v) => v.id === "next-actions")!.load!;
      expect(load.generatorSaturated).toBe(true);
      expect(load.opsPerSecond).toBeNull();
      expect(load.p95Ms).toBeNull();
      expect(load.requests).toBe(2376);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reduces mutations-summary to per-op rates and duration percentiles", () => {
    const root = makeResultsRoot();
    try {
      const run = buildRunsIndex(root, manifests).find(
        (r) => r.runId === "2026-10-09t17-44-06-935z",
      )!;
      const mutations = run.variants.find(
        (v) => v.id === "next-actions",
      )!.mutations!;
      expect(mutations.perOp.create).toEqual({ count: 50, rate: 5 });
      expect(mutations.perOp.delete).toEqual({ count: 50, rate: 5 });
      expect(mutations.duration!.avg).toBe(100);
      expect(mutations.duration!.p90).toBe(110);
      expect(mutations.duration!.max).toBe(140);
      expect(mutations.failures).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sums authored totals and leaves an absent footprint null", () => {
    const root = makeResultsRoot();
    try {
      const run = buildRunsIndex(root, manifests).find(
        (r) => r.runId === "2026-10-09t17-44-06-935z",
      )!;
      const inventory = run.variants.find(
        (v) => v.id === "next-actions",
      )!.inventory!;
      expect(inventory.totals).toEqual({ files: 17, loc: 170, bytes: 1700 });
      // inventory.json predates V3 → no footprint field → null.
      expect(inventory.footprint).toBeNull();
      expect(inventory.directDependencies).toBe(5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("renderViewerHtml / renderViewerData", () => {
  it("ships a data-free shell that fetches runs-data.json on the fly", () => {
    const root = makeResultsRoot();
    try {
      const runs = buildRunsIndex(root, manifests);
      const html = renderViewerHtml();
      // No run data is inlined in the shell — not even the run ids.
      expect(html).not.toContain('<script type="application/json"');
      for (const run of runs) {
        expect(html).not.toContain(`>${run.runId}<`);
      }
      // The shell loads its data at runtime from the sibling JSON file.
      expect(html).toContain('fetch("runs-data.json"');
      expect(html).toContain('id="run-select"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("data lists every run, and only the trimmed view", () => {
    const root = makeResultsRoot();
    try {
      const runs = buildRunsIndex(root, manifests);
      const data = renderViewerData(runs);
      const parsed = JSON.parse(data) as { runs: unknown[]; levels: unknown[] };
      expect(parsed.runs).toHaveLength(runs.length);
      expect(parsed.levels).toBeDefined();
      for (const run of runs) {
        expect(data).toContain(run.runId);
      }
      // Option labels are built from this payload at runtime.
      expect(data).toContain("smoke-matrix");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not embed raw samples, capture bodies or lifecycle stdout", () => {
    const root = makeResultsRoot();
    try {
      const data = renderViewerData(buildRunsIndex(root, manifests));
      expect(data).not.toContain("capture-secret-body");
      expect(data).not.toContain('"create":[100,200,300]'); // raw interaction array
      expect(data).not.toContain('"ttfb":10,"fcp":40'); // raw page array
      expect(data).not.toContain("raw-sample");
      expect(data).not.toContain("cpuPctOfEnv"); // raw resource series
      expect(data).not.toContain("memWorkingSetMb");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("escapes error strings containing < and & in the data payload", () => {
    const root = makeResultsRoot();
    try {
      const data = renderViewerData(buildRunsIndex(root, manifests));
      // The raw malicious sequence never appears…
      expect(data).not.toContain("<bad>");
      expect(data).not.toContain('<bad> & "</script>');
      // …because <, > and & are emitted as JSON unicode escapes.
      expect(data).toContain("\\u003cbad\\u003e");
      expect(data).toContain("\\u0026");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("contains no external src/href references (offline rule)", () => {
    const root = makeResultsRoot();
    try {
      const html = renderViewerHtml();
      // No `src=`/`href=` attributes at all, and no external resource loading.
      expect(/\bsrc\s*=/.test(html)).toBe(false);
      expect(/\bhref\s*=/.test(html)).toBe(false);
      expect(/\bsrc\s*=\s*["']https?:/i.test(html)).toBe(false);
      expect(/\bhref\s*=\s*["']https?:/i.test(html)).toBe(false);
      // The only fetch is the relative sibling data file, never an external URL.
      expect(html).not.toMatch(/fetch\(\s*["']https?:/i);
      expect(html).not.toContain("XMLHttpRequest");
      expect(html).not.toContain("<link");
      // The SVG namespace URI is a W3C identifier, not a fetched resource; it is
      // the only `http://` that may appear.
      const withoutSvgNs = html.replace(
        /http:\/\/www\.w3\.org\/2000\/svg/g,
        "",
      );
      expect(withoutSvgNs).not.toContain("http://");
      expect(withoutSvgNs).not.toContain("https://");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renders a valid page with no runs", () => {
    const html = renderViewerHtml();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('fetch("runs-data.json"');
    expect(html).toContain('id="run-select"');
  });

  it("ships compare-mode chrome and the D2 re-run banner template", () => {
    const html = renderViewerHtml();
    expect(html).toContain('id="mode-compare"');
    expect(html).toContain('id="compare-nav"');
    // The banner builds its command from the run's config file (plan D2).
    expect(html).toContain("pnpm rig:run --config ");
    expect(html).toContain("Not measured");
  });

  it("ships overlaid resource-comparison charts (one line per variant)", () => {
    const html = renderViewerHtml();
    expect(html).toContain("Overlaid — ");
    expect(html).toContain("function xyChart(");
    expect(html).toContain("function variantColor(");
  });
});

async function loadRun(root: string, runId: string): Promise<RunView> {
  return buildRunsIndex(root, manifests).find((r) => r.runId === runId)!;
}

describe("K1/K2/K3 reductions", () => {
  it("reduces per-path latency and threshold labels from load.json", async () => {
    const root = makeResultsRoot();
    try {
      const run = await loadRun(root, "2026-10-09t17-44-06-935z");
      const load = run.variants.find((v) => v.id === "next-actions")!.load!;
      expect(load.paths["/projects"]).toEqual({ p50Ms: 12.3, p95Ms: 30.1 });
      expect(load.thresholds).toEqual([
        { metric: "http_req_duration", expression: "p(95)<800", ok: false },
        { metric: "http_req_failed", expression: "rate<0.01", ok: true },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lifts threshold labels from the raw mutations summary", async () => {
    const root = makeResultsRoot();
    try {
      const run = await loadRun(root, "2026-10-09t17-44-06-935z");
      const mut = run.variants.find((v) => v.id === "next-actions")!.mutations!;
      expect(mut.thresholds).toEqual([
        { metric: "http_req_duration", expression: "p(95)<1500", ok: true },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reduces the capacity ladder and sorts steps by target rate", async () => {
    const root = makeResultsRoot();
    try {
      const run = await loadRun(root, "2026-10-09t17-44-06-935z");
      const capacity = run.variants.find(
        (v) => v.id === "next-actions",
      )!.capacity!;
      expect(capacity.mixed).toBe(true);
      expect(capacity.steps.map((s) => s.targetRate)).toEqual([10, 20]);
      expect(capacity.steps[1]!.achievedPerSecond).toBe(19.8);
      expect(capacity.steps[1]!.thresholds).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reduces resource aggregates and a downsampled series, tolerating old runs", async () => {
    const root = makeResultsRoot();
    try {
      const run = await loadRun(root, "2026-10-09t17-44-06-935z");
      const next = run.variants.find((v) => v.id === "next-actions")!;
      expect(next.loadService).toBe("app");
      expect(next.load!.resources!.services.app!.maxCpuPctOfEnv).toBe(99);
      expect(next.load!.resources!.oomKills).toBe(0);
      const step = next.capacity!.steps.find((s) => s.targetRate === 20)!;
      expect(step.resources!.services.app!.maxMemPctOfEnv).toBe(41);
      // The 1 Hz series is reduced to {t,cpu,mem} for the front service only.
      expect(next.resourceSeries.map((s) => s.label)).toEqual(["read"]);
      expect(next.resourceSeries[0]!.points).toEqual([
        { t: 0, cpu: 25, mem: 5 },
        { t: 1000, cpu: 50, mem: 10 },
      ]);
      // An older run without resource artefacts keeps blank (never zero).
      const old = await loadRun(root, "2026-10-09t15-00-00-000z");
      const oldNext = old.variants.find((v) => v.id === "next-actions")!;
      expect(oldNext.load).toBeNull();
      expect(oldNext.resourceSeries).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("D1/D2 effective stage selection", () => {
  function flaggedRoot(stages: unknown | null): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "bench-viewer-stages-"));
    const runId = "2026-10-10t15-15-18-542z";
    const preflight: Record<string, unknown> = {
      runId,
      gitRevision: "abc",
      config: "config/medium-load.yaml",
    };
    if (stages) preflight.stages = stages;
    write(root, path.join(runId, "preflight.json"), JSON.stringify(preflight));
    write(
      root,
      path.join(runId, "summary.json"),
      JSON.stringify({
        runId,
        effectiveManifestSha256: "abc",
        results: [summaryResult({ stages: { build: { ok: true, ms: 9 } } })],
      }),
    );
    return root;
  }

  it("records requestedStages from preflight.json (false → banner data)", async () => {
    const root = flaggedRoot({
      correctness: false,
      render: false,
      load: false,
    });
    try {
      const run = await loadRun(root, "2026-10-10t15-15-18-542z");
      expect(run.requestedStages).toEqual({
        correctness: false,
        render: false,
        load: false,
      });
      // The banner re-run command is built from the source config path.
      expect(run.configFile).toBe("config/medium-load.yaml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps requestedStages null for a pre-D1 run (never guess)", async () => {
    const root = flaggedRoot(null);
    try {
      const run = await loadRun(root, "2026-10-10t15-15-18-542z");
      expect(run.requestedStages).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records --only as a partial-run marker", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "bench-viewer-only-"));
    const runId = "2026-10-10t16-00-00-000z";
    try {
      write(
        root,
        path.join(runId, "preflight.json"),
        JSON.stringify({
          runId,
          config: "config/medium-load.yaml",
          stages: { correctness: true, render: true, load: true },
          only: ["next-actions"],
        }),
      );
      write(
        root,
        path.join(runId, "summary.json"),
        JSON.stringify({ runId, results: [summaryResult()] }),
      );
      const run = await loadRun(root, runId);
      expect(run.only).toEqual(["next-actions"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("compare model (V-B)", () => {
  const runView = (overrides: Partial<RunView>): RunView => ({
    runId: "r",
    incomplete: false,
    configName: null,
    configFile: null,
    gitRevision: null,
    effectiveManifestSha256: null,
    startedAt: null,
    okCount: 0,
    totalCount: 0,
    inputs: null,
    requestedStages: null,
    only: null,
    variants: [],
    ...overrides,
  });

  const inputs = (
    taskCount: number,
    counts: Record<string, number>,
    cpus: number,
    mem: number,
    rates: number[],
  ): Record<string, unknown> => ({
    name: "cfg",
    trials: 1,
    fixture: { taskCount, projectCount: 1, userCount: 1, commentCount: 1 },
    scenarios: [
      { id: "v", kind: "volume", counts, concurrency: 5 },
      {
        id: "c",
        kind: "capacity",
        ratesPerSecond: rates,
        durationPerStepSeconds: 30,
      },
    ],
    resources: {
      appCpus: cpus,
      appMemoryMb: mem,
      dbCpus: cpus,
      dbMemoryMb: mem,
    },
  });

  it("groups configName × envelope and orders levels by the derived ordinal", () => {
    const runs: RunView[] = [
      runView({
        runId: "2026-10-10t10-00-00-000z",
        configName: "medium-load",
        inputs: inputs(
          10000,
          { list: 400, create: 100 },
          2,
          2048,
          [10, 20, 40],
        ),
      }),
      runView({
        runId: "2026-10-10t09-00-00-000z",
        configName: "smoke-matrix",
        inputs: inputs(1000, { list: 100 }, 2, 2048, [5, 10]),
      }),
      // Same config, different envelope → a *distinct* level (R4).
      runView({
        runId: "2026-10-10t11-00-00-000z",
        configName: "medium-load",
        inputs: inputs(
          10000,
          { list: 400, create: 100 },
          4,
          4096,
          [10, 20, 40],
        ),
      }),
      // Older run of the same config × envelope → same level, listed after.
      runView({
        runId: "2026-10-10t08-00-00-000z",
        configName: "medium-load",
        inputs: inputs(
          10000,
          { list: 400, create: 100 },
          2,
          2048,
          [10, 20, 40],
        ),
      }),
    ];
    const levels = deriveLoadLevels(runs);
    expect(levels.map((l) => l.key)).toEqual([
      "smoke-matrix@2c/2048MB",
      "medium-load@2c/2048MB",
      "medium-load@4c/4096MB",
    ]);
    const medium2 = levels[1]!;
    expect(medium2.runIds).toEqual([
      "2026-10-10t10-00-00-000z",
      "2026-10-10t08-00-00-000z",
    ]);
    expect(medium2.label).toBe("medium-load @ 2c/2048MB");
    expect(medium2.ordinal.taskCount).toBe(10000);
    expect(medium2.ordinal.maxRate).toBe(40);
  });

  it("groups configs without a name by run-id", () => {
    const levels = deriveLoadLevels([
      runView({ runId: "2026-10-10t12-00-00-000z", inputs: { fixture: {} } }),
    ]);
    expect(levels).toHaveLength(1);
    expect(levels[0]!.key).toBe("run:2026-10-10t12-00-00-000z");
    expect(levels[0]!.label).toBe("2026-10-10t12-00-00-000z");
  });

  it("round-trips the compare deep link", () => {
    const state = { runIds: ["a", "b"], metric: "p95" };
    const hash = formatCompareHash(state);
    expect(hash).toBe("compare=a,b&metric=p95");
    expect(parseCompareHash("#" + hash)).toEqual(state);
    expect(parseCompareHash("compare=x,y")).toEqual({
      runIds: ["x", "y"],
      metric: "ops",
    });
  });
});
