import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadManifestDirectory } from "../src/config/load.js";
import { variantManifestSchema } from "../src/config/schema.js";

const rigRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const baseSpa = {
  schemaVersion: 2,
  id: "x",
  cohort: "spa-api",
  appDirectory: "../apps/x",
  composeFile: "../apps/x/compose.yaml",
  projectPrefix: "bench-x",
  services: {
    api: { composeService: "api", kind: "api", healthPath: "/healthz", hostPortEnv: "API_PORT" },
    spa: {
      composeService: "spa",
      kind: "spa",
      healthPath: "/",
      hostPortEnv: "SPA_PORT",
      buildArgs: { VITE_API_URL: "http://localhost:{{API_PORT}}" },
    },
    db: { composeService: "db", kind: "db" },
    seeder: { composeService: "seeder", kind: "seeder" },
  },
  seed: { command: ["compose", "run", "--rm", "seeder", "seed"] },
  reset: { command: ["compose", "run", "--rm", "seeder", "reset"] },
  capabilities: ["list", "detail"],
  readMode: "spa-fetch-rest",
  mutationMode: "rest",
  orm: "none",
} as const;

describe("variant manifest schema v2", () => {
  it("validates every shipped manifest and matches the default config", async () => {
    const manifests = await loadManifestDirectory(path.join(rigRoot, "manifests"));
    const config = await loadConfig(path.join(rigRoot, "config", "default.yaml"));

    expect(manifests.size).toBe(14);
    expect([...manifests.keys()].sort()).toEqual([...config.variants].sort());
  });

  it("gives spa-api variants an api + spa pair and singles an app", async () => {
    const manifests = await loadManifestDirectory(path.join(rigRoot, "manifests"));
    for (const manifest of manifests.values()) {
      if (manifest.cohort === "spa-api") {
        expect(manifest.services.api, manifest.id).toBeDefined();
        expect(manifest.services.spa, manifest.id).toBeDefined();
        expect(manifest.services.app, manifest.id).toBeUndefined();
      } else {
        expect(manifest.services.app, manifest.id).toBeDefined();
        expect(manifest.services.api, manifest.id).toBeUndefined();
        expect(manifest.services.spa, manifest.id).toBeUndefined();
      }
    }
  });

  it("accepts a well-formed spa-api manifest", () => {
    expect(variantManifestSchema.safeParse(baseSpa).success).toBe(true);
  });

  it("rejects a variant that declares both app and api", () => {
    const manifest = structuredClone(baseSpa) as any;
    manifest.services.app = { composeService: "app", kind: "app", healthPath: "/healthz", hostPortEnv: "APP_PORT" };
    expect(variantManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects a published service missing its healthPath or hostPortEnv", () => {
    const manifest = structuredClone(baseSpa) as any;
    delete manifest.services.api.hostPortEnv;
    expect(variantManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects a db service carrying a host port", () => {
    const manifest = structuredClone(baseSpa) as any;
    manifest.services.db.hostPortEnv = "DB_PORT";
    expect(variantManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects two published services sharing a host-port env", () => {
    const manifest = structuredClone(baseSpa) as any;
    manifest.services.spa.hostPortEnv = "API_PORT";
    expect(variantManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
