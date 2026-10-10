import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectInventory,
  countDirectDependencies,
  discoverDependencyManifests,
} from "../src/reporting/inventory.js";

// Dependency-manifest discovery (plan D3). The bug it fixes: a root-only lookup
// returned 0 for every `spa-api` variant, because each half keeps its own
// manifest in a subdirectory.

const rigRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(rigRoot, "..");

function tmpApp(): string {
  return mkdtempSync(path.join(os.tmpdir(), "bench-deps-"));
}

function write(root: string, relative: string, contents: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

const npmManifest = (deps: string[]): string =>
  JSON.stringify({
    dependencies: Object.fromEntries(deps.map((d) => [d, "*"])),
  });

describe("discoverDependencyManifests", () => {
  it("counts both halves of a nested spa-api-style tree", () => {
    const dir = tmpApp();
    try {
      write(
        dir,
        "express-rest/package.json",
        npmManifest(["a", "b", "c", "d"]),
      );
      write(dir, "tanstack-rest/package.json", npmManifest(["e", "f"]));
      const manifests = discoverDependencyManifests(dir);
      expect(manifests).toEqual([
        {
          path: "express-rest/package.json",
          kind: "npm",
          directDependencies: 4,
        },
        {
          path: "tanstack-rest/package.json",
          kind: "npm",
          directDependencies: 2,
        },
      ]);
      expect(countDirectDependencies(dir)).toBe(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores manifests under node_modules, dist and lockfiles", () => {
    const dir = tmpApp();
    try {
      write(dir, "package.json", npmManifest(["a"]));
      write(dir, "node_modules/dep/package.json", npmManifest(["x", "y", "z"]));
      write(dir, "dist/package.json", npmManifest(["x"]));
      write(dir, "pnpm-lock.yaml", "lockfileVersion: 9\n");
      const manifests = discoverDependencyManifests(dir);
      expect(manifests.map((m) => m.path)).toEqual(["package.json"]);
      expect(countDirectDependencies(dir)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles a mixed npm + python + elixir tree; the sum equals the parts", () => {
    const dir = tmpApp();
    try {
      write(dir, "spa/package.json", npmManifest(["a", "b"]));
      write(
        dir,
        "api/pyproject.toml",
        '[project]\ndependencies = [\n  "fastapi",\n  "uvicorn",\n]\n',
      );
      write(
        dir,
        "api/mix.exs",
        'defp deps do\n  [{:phoenix, "~> 1.7"}, {:ecto, "~> 3.0"}]\nend\n',
      );
      const manifests = discoverDependencyManifests(dir);
      expect(manifests).toEqual([
        { path: "api/mix.exs", kind: "elixir", directDependencies: 2 },
        { path: "api/pyproject.toml", kind: "python", directDependencies: 2 },
        { path: "spa/package.json", kind: "npm", directDependencies: 2 },
      ]);
      expect(countDirectDependencies(dir)).toBe(
        manifests.reduce((total, m) => total + m.directDependencies, 0),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts devDependencies as zero (npm `dependencies` only)", () => {
    const dir = tmpApp();
    try {
      write(
        dir,
        "package.json",
        JSON.stringify({
          dependencies: { a: "*" },
          devDependencies: { b: "*" },
        }),
      );
      expect(countDirectDependencies(dir)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("inventory on the real app tree", () => {
  it("reports the audited direct-dependency totals (per-manifest breakdown)", () => {
    const expected: Record<string, { total: number; manifests: number }> = {
      "tanstack-express-rest": { total: 14, manifests: 2 },
      "tanstack-fastify-rest": { total: 14, manifests: 2 },
      "tanstack-express-graphql": { total: 17, manifests: 2 },
      "tanstack-express-orpc": { total: 24, manifests: 2 },
      "tanstack-flask-rest": { total: 12, manifests: 2 },
      "tanstack-fastapi-rest": { total: 11, manifests: 2 },
      "tanstack-elixir-rest": { total: 30, manifests: 2 },
      "next-actions": { total: 5, manifests: 1 },
      "next-drizzle": { total: 7, manifests: 1 },
      "next-prisma": { total: 8, manifests: 1 },
      "next-trpc": { total: 11, manifests: 1 },
      "next-orpc": { total: 15, manifests: 1 },
      "tanstack-start-react": { total: 13, manifests: 1 },
      "tanstack-start-solid": { total: 11, manifests: 1 },
    };
    for (const [variant, want] of Object.entries(expected)) {
      const manifests = discoverDependencyManifests(
        path.join(repoRoot, "apps", variant),
      );
      expect(manifests.length, variant).toBe(want.manifests);
      expect(
        manifests.reduce((total, m) => total + m.directDependencies, 0),
        variant,
      ).toBe(want.total);
    }
  });
});
