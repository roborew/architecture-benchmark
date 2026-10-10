import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VariantManifest } from "../src/config/schema.js";
import {
  buildRunsIndex,
  parseRunId,
  renderViewerHtml,
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
        },
        http_req_failed: { fails: 2, passes: 148 },
        mk_create_ok: { count: 50, rate: 5 },
        mk_update_ok: { count: 50, rate: 5 },
        mk_delete_ok: { count: 50, rate: 5 },
      },
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

describe("renderViewerHtml", () => {
  it("lists every run as an option and a deep-link target", () => {
    const root = makeResultsRoot();
    try {
      const runs = buildRunsIndex(root, manifests);
      const html = renderViewerHtml(runs);
      for (const run of runs) {
        expect(html).toContain(`<option value="${run.runId}">`);
      }
      expect(html).toContain('id="runs-data"');
      expect(html).toContain("smoke-matrix");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not embed raw samples, capture bodies or lifecycle stdout", () => {
    const root = makeResultsRoot();
    try {
      const html = renderViewerHtml(buildRunsIndex(root, manifests));
      expect(html).not.toContain("capture-secret-body");
      expect(html).not.toContain('"create":[100,200,300]'); // raw interaction array
      expect(html).not.toContain('"ttfb":10,"fcp":40'); // raw page array
      expect(html).not.toContain("raw-sample");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("escapes error strings containing < and & in the embedded payload", () => {
    const root = makeResultsRoot();
    try {
      const html = renderViewerHtml(buildRunsIndex(root, manifests));
      // The raw malicious sequence never appears…
      expect(html).not.toContain("<bad>");
      expect(html).not.toContain('<bad> & "</script>');
      // …because <, > and & are emitted as JSON unicode escapes.
      expect(html).toContain("\\u003cbad\\u003e");
      expect(html).toContain("\\u0026");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("contains no external src/href references (offline rule)", () => {
    const root = makeResultsRoot();
    try {
      const html = renderViewerHtml(buildRunsIndex(root, manifests));
      expect(/\bsrc\s*=/.test(html)).toBe(false);
      expect(/\bhref\s*=/.test(html)).toBe(false);
      expect(html).not.toContain("http://");
      expect(html).not.toContain("https://");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renders a valid page with no runs", () => {
    const html = renderViewerHtml([]);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('id="runs-data"');
    expect(html).toContain('id="run-select"');
  });
});
