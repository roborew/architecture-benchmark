import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifestDirectory } from "../src/config/load.js";
import { allocateDistinctHostPorts, allocateHostPorts } from "../src/controller/ports.js";
import { resolveTokens, resolveTokenMap } from "../src/controller/tokens.js";
import { checkEligibility, eligibilityPools, poolSize } from "../src/controller/fixture.js";
import { composeEnv, planVariant } from "../src/controller/plan.js";

const rigRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("token resolution", () => {
  it("substitutes known tokens", () => {
    expect(resolveTokens("http://localhost:{{API_PORT}}", { API_PORT: 4321 })).toBe(
      "http://localhost:4321",
    );
    expect(resolveTokens("{{ A }} {{B}}", { A: "x", B: 2 })).toBe("x 2");
  });

  it("throws on an unknown token rather than shipping a literal", () => {
    expect(() => resolveTokens("{{NOPE}}", {})).toThrow(/unknown manifest token/);
  });

  it("resolves a whole build-arg map", () => {
    expect(resolveTokenMap({ VITE_API_URL: "http://localhost:{{API_PORT}}" }, { API_PORT: 5000 })).toEqual({
      VITE_API_URL: "http://localhost:5000",
    });
  });
});

describe("host-port allocation", () => {
  it("returns the requested number of distinct ports", async () => {
    const ports = await allocateDistinctHostPorts(4);
    expect(ports).toHaveLength(4);
    expect(new Set(ports).size).toBe(4);
    for (const port of ports) expect(port).toBeGreaterThan(0);
  });

  it("maps ports to env names", async () => {
    const allocated = await allocateHostPorts(["API_PORT", "SPA_PORT"]);
    expect(Object.keys(allocated).sort()).toEqual(["API_PORT", "SPA_PORT"]);
  });
});

describe("fixture eligibility", () => {
  const small = {
    seedVersion: 1 as const,
    seed: 42,
    projectCount: 5,
    userCount: 20,
    taskCount: 1000,
    commentCount: 1000,
    baseTimestamp: "2025-01-01T00:00:00Z",
    statusPercent: { todo: 50, "in progress": 30, done: 20 },
    workingSetFraction: 0.2,
  };

  it("derives the spec ID bands", () => {
    const pools = eligibilityPools(small);
    expect(pools.readPool).toEqual({ from: 1, to: 500 });
    expect(pools.updatePool).toEqual({ from: 501, to: 800 });
    expect(pools.deletePool).toEqual({ from: 801, to: 1000 });
    expect(poolSize(pools.updatePool)).toBe(300);
    expect(poolSize(pools.deletePool)).toBe(200);
  });

  it("accepts a plan within the pools", () => {
    expect(checkEligibility(small, { updates: 100, deletes: 100 }).ok).toBe(true);
  });

  it("rejects a plan that exceeds the delete pool", () => {
    const result = checkEligibility(small, { updates: 100, deletes: 201 });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/deletePool/);
  });
});

describe("planVariant", () => {
  const resources = { appCpus: 2, appMemoryMb: 2048, dbCpus: 2, dbMemoryMb: 2048 };

  it("resolves a spa-api pair: absolute paths, unique project, distinct ports, tokens", async () => {
    const manifests = await loadManifestDirectory(path.join(rigRoot, "manifests"));
    const variant = await planVariant(manifests.get("tanstack-express-rest")!, {
      rigRoot,
      runId: "run1",
      resources,
    });

    expect(variant.projectName).toBe("bench-tanstack-express-rest-run1");
    expect(path.isAbsolute(variant.composeFile)).toBe(true);
    expect(variant.published.map((s) => s.slot)).toEqual(["api", "spa"]);
    expect(variant.services.api!.hostPort).not.toBe(variant.services.spa!.hostPort);
    expect(variant.services.spa!.buildArgs!.VITE_API_URL).toBe(
      `http://localhost:${variant.services.api!.hostPort}`,
    );

    const env = composeEnv(variant, resources);
    expect(env.API_PORT).toBe(String(variant.services.api!.hostPort));
    expect(env.SPA_PORT).toBe(String(variant.services.spa!.hostPort));
    expect(env.CORS_ORIGIN).toBe(`http://localhost:${variant.services.spa!.hostPort}`);
    expect(env.POSTGRES_URL).toContain("@db:5432/bench");
    expect(env.DB_CPUS).toBe("2");
  });

  it("resolves a single-service variant with no CORS origin", async () => {
    const manifests = await loadManifestDirectory(path.join(rigRoot, "manifests"));
    const variant = await planVariant(manifests.get("next-actions")!, {
      rigRoot,
      runId: "run1",
      resources,
    });
    expect(variant.published.map((s) => s.slot)).toEqual(["app"]);
    const env = composeEnv(variant, resources);
    expect(env.APP_PORT).toBe(String(variant.services.app!.hostPort));
    expect(env.CORS_ORIGIN).toBeUndefined();
  });
});
