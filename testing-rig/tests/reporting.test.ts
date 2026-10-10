import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectInventory,
  countDirectDependencies,
} from "../src/reporting/inventory.js";
import {
  buildMatrix,
  percentile,
  toCsv,
  toHtml,
  toMarkdown,
  type RenderReport,
  type RunSummary,
} from "../src/reporting/matrix.js";
import { loadManifestDirectory } from "../src/config/load.js";

const rigRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(rigRoot, "..");

describe("static inventory", () => {
  it("counts a real app and excludes deps, build output and generated code", () => {
    const inventory = collectInventory({
      variantId: "next-actions",
      appDirectory: path.join(repoRoot, "apps", "next-actions"),
      serviceCount: 3,
      imageCount: 3,
    });
    expect(inventory.source.files).toBeGreaterThan(20);
    expect(inventory.source.loc).toBeGreaterThan(1000);
    // The bug the counting rules exist to catch: generated/build output must not
    // inflate source. node_modules/`.next` must be excluded.
    expect(inventory.source.files).toBeLessThan(500);
    expect(inventory.tests.files).toBeGreaterThan(0);
    expect(inventory.infrastructure.files).toBeGreaterThan(0);
    expect(inventory.directDependencies).toBeGreaterThan(3);
  });

  it("counts direct dependencies from package.json", () => {
    expect(
      countDirectDependencies(path.join(repoRoot, "apps", "next-actions")),
    ).toBeGreaterThan(3);
  });

  it("excludes deps from authored counts but includes them in the footprint", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bench-inventory-"));
    try {
      writeFileSync(path.join(dir, "index.ts"), "export const a = 1;\n");
      mkdirSync(path.join(dir, "node_modules", "dep"), { recursive: true });
      writeFileSync(
        path.join(dir, "node_modules", "dep", "index.js"),
        "module.exports = 42;\n",
      );
      const inventory = collectInventory({
        variantId: "tmp",
        appDirectory: dir,
        serviceCount: 1,
        imageCount: 1,
      });
      // Authored source excludes node_modules…
      expect(inventory.source.files).toBe(1);
      // …but the on-disk footprint (the `du` view) includes it.
      expect(inventory.footprint).not.toBeNull();
      expect(inventory.footprint!.files).toBe(2);
      expect(inventory.footprint!.bytes).toBeGreaterThan(
        inventory.source.bytes,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("decision matrix", () => {
  const summary: RunSummary = {
    runId: "test-run",
    effectiveManifestSha256: "abc123",
    results: [
      {
        id: "next-actions",
        cohort: "next-fullstack",
        status: "ok",
        performanceEligible: true,
        ports: { APP_PORT: 1 },
        stages: {
          build: { ok: true, ms: 10 },
          seed: { ok: true, ms: 20 },
          verifyDigest: { ok: true, ms: 5 },
        },
        error: null,
      },
      {
        id: "tanstack-express-rest",
        cohort: "spa-api",
        status: "failed",
        performanceEligible: false,
        ports: { API_PORT: 2, SPA_PORT: 3 },
        stages: { build: { ok: true, ms: 11 } },
        error: "boom",
      },
    ],
  };

  it("renders CSV, Markdown and HTML from raw data", async () => {
    const manifests = await loadManifestDirectory(
      path.join(rigRoot, "manifests"),
    );
    const rows = buildMatrix(summary, new Map(), manifests);

    expect(rows).toHaveLength(2);
    expect(rows[0]!.gate).toBe("pass");
    expect(rows[1]!.gate).toBe("fail");
    expect(rows[0]!.orm).toBe("none");
    expect(rows[0]!.buildMs).toBe(10);
    // Not-yet-measured perf columns stay empty, never zero.
    expect(rows[0]!.renderTtfbMs).toBeNull();
    expect(rows[0]!.loadOpsPerSecond).toBeNull();

    const csv = toCsv(rows);
    expect(csv.split("\n")[0]).toContain("variant,cohort,orm");
    expect(csv).toContain("next-actions");

    const md = toMarkdown(rows, {
      runId: summary.runId,
      sha256: summary.effectiveManifestSha256,
    });
    expect(md).toContain("Decision matrix");
    expect(md).toContain("| variant |");

    const html = toHtml(rows, {
      runId: summary.runId,
      sha256: summary.effectiveManifestSha256,
    });
    expect(html).toContain("<table>");
    expect(html).toContain("gate-pass");
    expect(html).toContain("gate-fail");
  });

  it("populates render columns from the collector's raw samples", async () => {
    const manifests = await loadManifestDirectory(
      path.join(rigRoot, "manifests"),
    );
    const render = new Map<string, RenderReport>([
      [
        "next-actions",
        {
          variant: "next-actions",
          pages: {
            board: [
              { ttfb: 10, fcp: 40, lcp: 60, firstData: 80 },
              { ttfb: 20, fcp: 50, lcp: 70, firstData: 90 },
              { ttfb: 30, fcp: 60, lcp: 80, firstData: 100 },
            ],
          },
          interactions: {
            create: [100, 200, 300],
            update: [120, 220, 320],
            delete: [90, 190, 290],
          },
        },
      ],
    ]);
    const rows = buildMatrix(summary, new Map(), manifests, render);
    const next = rows.find((r) => r.variant === "next-actions")!;
    expect(next.renderTtfbMs).toBe(20);
    expect(next.renderLcpMs).toBe(70);
    expect(next.renderFirstDataMs).toBe(90);
    expect(next.createP50Ms).toBe(200);
    // A variant with no render artefact keeps blank (never zero) render cells.
    const other = rows.find((r) => r.variant === "tanstack-express-rest")!;
    expect(other.renderTtfbMs).toBeNull();
  });

  it("computes percentiles with interpolation", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
  });
});
