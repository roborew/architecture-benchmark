import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveRunManifest, loadConfig } from "../src/config/load.js";
import { rigConfigSchema } from "../src/config/schema.js";

const rigRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const baseConfig = {
  schemaVersion: 1,
  name: "test",
  variants: ["next-actions"],
  trials: 1,
  variantOrder: "rotate",
  fixture: {
    seedVersion: 1,
    seed: 42,
    projectCount: 5,
    userCount: 20,
    taskCount: 1000,
    commentCount: 1000,
    baseTimestamp: "2025-01-01T00:00:00Z",
    statusPercent: { todo: 50, "in progress": 30, done: 20 },
    workingSetFraction: 0.2,
  },
  reset: { betweenPhases: true, betweenTrials: true, method: "database-recreate" },
  browser: {
    engine: "chromium",
    workers: 1,
    warmupSamples: 10,
    measuredSamples: 30,
    viewport: { width: 1365, height: 768 },
    cacheProfile: "cold-browser-context",
    prefetch: "disabled",
    operations: ["list", "detail", "create", "update", "delete"],
  },
  scenarios: [
    {
      id: "v1",
      kind: "volume",
      counts: { list: 10, detail: 0, create: 0, update: 0, delete: 0 },
      concurrency: 1,
      maxAttemptsPerOperation: 11,
      maxDurationSeconds: 60,
      resetBefore: true,
    },
  ],
  network: { browserToAppAddedRttMs: 0, appToApiAddedRttMs: 0 },
  resources: { appCpus: 2, appMemoryMb: 2048, dbCpus: 2, dbMemoryMb: 2048 },
  report: { keepRawSamples: true, outputFormats: ["json"] },
} as const;

const parse = (mutate: (cfg: any) => void) => {
  const cfg = structuredClone(baseConfig) as any;
  mutate(cfg);
  return rigConfigSchema.safeParse(cfg);
};

describe("experiment config schema", () => {
  it("loads the shipped default and smoke configs", async () => {
    const def = await loadConfig(path.join(rigRoot, "config", "default.yaml"));
    expect(def.variants).toHaveLength(14);
    expect(def.variants).not.toContain("next-template");
    expect(def.load.generatorMaxCpuPercent).toBe(75);

    const smoke = await loadConfig(path.join(rigRoot, "config", "smoke-matrix.yaml"));
    expect(smoke.trials).toBe(1);
    expect(smoke.scenarios).toHaveLength(1);
  });

  it("defaults generatorMaxCpuPercent when `load:` is absent", () => {
    const result = rigConfigSchema.parse(baseConfig as any);
    expect(result.load.generatorMaxCpuPercent).toBe(75);
  });

  it("rejects unknown keys (strict)", () => {
    expect(parse((c) => (c.extra = true)).success).toBe(false);
  });

  it("rejects the illustrative single `workload:` mapping", () => {
    expect(parse((c) => (c.scenarios = [{ id: "w", workload: {} }])).success).toBe(false);
  });

  it("rejects statusPercent that does not sum to 100", () => {
    expect(
      parse((c) => (c.fixture.statusPercent = { todo: 50, "in progress": 30, done: 30 })).success,
    ).toBe(false);
  });

  it("rejects a nonzero appToApiAddedRttMs", () => {
    expect(parse((c) => (c.network.appToApiAddedRttMs = 5)).success).toBe(false);
  });

  it("rejects a duplicate variant id", () => {
    expect(parse((c) => (c.variants = ["next-actions", "next-actions"])).success).toBe(false);
  });

  it("rejects generatorMaxCpuPercent out of range", () => {
    expect(parse((c) => (c.load = { generatorMaxCpuPercent: 150 })).success).toBe(false);
    expect(parse((c) => (c.load = { generatorMaxCpuPercent: 0 })).success).toBe(false);
  });

  it("hashes the effective run manifest deterministically", async () => {
    const config = await loadConfig(path.join(rigRoot, "config", "smoke-matrix.yaml"));
    const a = effectiveRunManifest(config);
    const b = effectiveRunManifest(config);
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
