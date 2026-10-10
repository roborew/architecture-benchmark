import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveRunManifest, loadConfig } from "../src/config/load.js";
import { rigConfigSchema } from "../src/config/schema.js";

const rigRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

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
  reset: {
    betweenPhases: true,
    betweenTrials: true,
    method: "database-recreate",
  },
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
  it("loads the shipped load x resource matrix (small/medium/large x 1c1g/2c2g/4c4g)", async () => {
    const levels = [
      { level: "small", trials: 1, taskCount: 1000 },
      { level: "medium", trials: 2, taskCount: 10000 },
      { level: "large", trials: 3, taskCount: 100000 },
    ];
    const envelopes = [
      { tag: "1c1g", cpus: 1, memoryMb: 1024 },
      { tag: "2c2g", cpus: 2, memoryMb: 2048 },
      { tag: "4c4g", cpus: 4, memoryMb: 4096 },
    ];
    for (const { level, trials, taskCount } of levels) {
      for (const env of envelopes) {
        const file = `${level}-${env.tag}.yaml`;
        const cfg = await loadConfig(path.join(rigRoot, "config", file));
        expect(cfg.name, file).toBe(level);
        expect(cfg.variants, file).toHaveLength(14);
        expect(cfg.variants, file).not.toContain("next-template");
        expect(cfg.trials, file).toBe(trials);
        expect(cfg.fixture.taskCount, file).toBe(taskCount);
        // Each file bakes its own resource caps (the matrix's other axis).
        expect(cfg.resources, file).toEqual({
          appCpus: env.cpus,
          appMemoryMb: env.memoryMb,
          dbCpus: env.cpus,
          dbMemoryMb: env.memoryMb,
        });
        expect(cfg.load.generatorMaxCpuPercent, file).toBe(75);
        expect(
          cfg.scenarios.map((s) => s.kind),
          file,
        ).toEqual(["volume", "capacity"]);
      }
    }
  });

  it("defaults generatorMaxCpuPercent when `load:` is absent", () => {
    const result = rigConfigSchema.parse(baseConfig as any);
    expect(result.load.generatorMaxCpuPercent).toBe(75);
  });

  it("defaults every stage selection to false when `stages:` is absent", () => {
    const result = rigConfigSchema.parse(baseConfig as any);
    expect(result.stages).toEqual({
      correctness: false,
      render: false,
      load: false,
    });
  });

  it("accepts a full `stages:` block", () => {
    const result = parse(
      (c) => (c.stages = { correctness: true, render: true, load: true }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stages).toEqual({
        correctness: true,
        render: true,
        load: true,
      });
    }
  });

  it("rejects an unknown key inside `stages:` (strict)", () => {
    expect(
      parse((c) => (c.stages = { correctness: true, mutations: true })).success,
    ).toBe(false);
  });

  it("rejects a non-boolean stage value", () => {
    expect(parse((c) => (c.stages = { render: "yes" })).success).toBe(false);
  });

  it("selects all three stages in the shipped matrix, none in the example", async () => {
    for (const file of [
      "small-1c1g.yaml",
      "medium-2c2g.yaml",
      "large-4c4g.yaml",
    ]) {
      const config = await loadConfig(path.join(rigRoot, "config", file));
      expect(config.stages, file).toEqual({
        correctness: true,
        render: true,
        load: true,
      });
    }
    const example = await loadConfig(
      path.join(rigRoot, "config", "examples", "volume-1000-writes.yaml"),
    );
    expect(example.stages).toEqual({
      correctness: false,
      render: false,
      load: false,
    });
  });

  it("rejects unknown keys (strict)", () => {
    expect(parse((c) => (c.extra = true)).success).toBe(false);
  });

  it("rejects the illustrative single `workload:` mapping", () => {
    expect(
      parse((c) => (c.scenarios = [{ id: "w", workload: {} }])).success,
    ).toBe(false);
  });

  it("rejects statusPercent that does not sum to 100", () => {
    expect(
      parse(
        (c) =>
          (c.fixture.statusPercent = { todo: 50, "in progress": 30, done: 30 }),
      ).success,
    ).toBe(false);
  });

  it("rejects a nonzero appToApiAddedRttMs", () => {
    expect(parse((c) => (c.network.appToApiAddedRttMs = 5)).success).toBe(
      false,
    );
  });

  it("rejects a duplicate variant id", () => {
    expect(
      parse((c) => (c.variants = ["next-actions", "next-actions"])).success,
    ).toBe(false);
  });

  it("rejects generatorMaxCpuPercent out of range", () => {
    expect(
      parse((c) => (c.load = { generatorMaxCpuPercent: 150 })).success,
    ).toBe(false);
    expect(parse((c) => (c.load = { generatorMaxCpuPercent: 0 })).success).toBe(
      false,
    );
  });

  it("hashes the effective run manifest deterministically", async () => {
    const config = await loadConfig(
      path.join(rigRoot, "config", "small-2c2g.yaml"),
    );
    const a = effectiveRunManifest(config);
    const b = effectiveRunManifest(config);
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
