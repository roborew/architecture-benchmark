// Static & complexity inventory (plan §6.1), collected once per run.
//
// The counting rules matter: an initial survey counted generated test-data and
// build output as "source" (e.g. `next-actions` ~292k LOC). So this splits
// app-authored source from tests and infrastructure, and excludes dependencies,
// build output, lockfiles, generated code, fixtures and reports.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Directories never counted (deps, build output, caches). */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".next-e2e",
  ".output",
  ".tanstack",
  ".nitro",
  ".wrangler",
  "dist",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
  "blob-report",
  ".pnpm",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "_build",
  "deps",
  "target",
  ".elixir_ls",
]);

/** Files never counted (lockfiles, generated code, build metadata). */
const EXCLUDED_FILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "mix.lock",
  "poetry.lock",
  "uv.lock",
  "routeTree.gen.ts",
  ".DS_Store",
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "Python",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".heex": "Elixir",
  ".eex": "Elixir",
  ".css": "CSS",
  ".scss": "CSS",
  ".html": "HTML",
  ".sql": "SQL",
  ".sh": "Shell",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".md": "Markdown",
};

const INFRA_FILES =
  /^(Dockerfile|Caddyfile|docker-compose\.ya?ml|compose\.ya?ml|\.dockerignore|next\.config\.(ts|js|mjs)|vite\.config\.(ts|js|mjs)|tsconfig.*\.json|eslint\.config\.(mjs|js)|postcss\.config\.(mjs|js)|tailwind\.config\.(ts|js)|biome\.json|drizzle\.config\.ts|prisma\d*\.config\.ts|vitest\.config\.ts|vitest\.setup\.ts|playwright\.config\.ts|tsr\.config\.json)$$/;

function isTestPath(relative: string): boolean {
  if (/(^|\/)(tests|test|__tests__|e2e|integration)\//.test(relative))
    return true;
  return (
    /\.(test|spec|integration)\.[cm]?[jt]sx?$/.test(relative) ||
    /(^|\/)(test_.*|.*_test)\.py$/.test(relative)
  );
}

type LanguageTotals = { files: number; loc: number; bytes: number };

/** A dependency manifest discovered under the app directory (plan D3). */
export interface DependencyManifest {
  /** Path relative to the app directory, e.g. `express-rest/package.json`. */
  path: string;
  kind: "npm" | "python" | "elixir";
  directDependencies: number;
}

export interface InventoryBucket {
  files: number;
  loc: number;
  bytes: number;
  byLanguage: Record<string, LanguageTotals>;
}

export interface StaticInventory {
  variantId: string;
  source: InventoryBucket;
  tests: InventoryBucket;
  infrastructure: InventoryBucket;
  /**
   * Every dependency manifest discovered under the app directory (plan D3).
   * `spa-api` variants keep one manifest per half in a subdirectory, so a
   * root-only lookup undercounted them; the sum below fixes that.
   */
  dependencyManifests: DependencyManifest[];
  /** Sum of `dependencyManifests[].directDependencies`. */
  directDependencies: number;
  languages: number;
  serviceCount: number;
  imageCount: number;
  /**
   * Stat-only walk of the app directory with **no exclusions** — what `du`
   * would see (deps, build output and lockfiles included). The authored
   * buckets above exclude those; the two answer different questions and
   * conflating them was the original counting bug (see the header comment).
   * Absent in inventory.json files written before this field existed.
   */
  footprint: { files: number; bytes: number } | null;
}

function emptyBucket(): InventoryBucket {
  return { files: 0, loc: 0, bytes: 0, byLanguage: {} };
}

function add(
  bucket: InventoryBucket,
  language: string,
  loc: number,
  bytes: number,
): void {
  bucket.files += 1;
  bucket.loc += loc;
  bucket.bytes += bytes;
  const entry = (bucket.byLanguage[language] ??= {
    files: 0,
    loc: 0,
    bytes: 0,
  });
  entry.files += 1;
  entry.loc += loc;
  entry.bytes += bytes;
}

function walk(
  root: string,
): Array<{ relative: string; bytes: number; loc: number }> {
  const files: Array<{ relative: string; bytes: number; loc: number }> = [];
  const stack = [""];
  while (stack.length > 0) {
    const relativeDir = stack.pop()!;
    const absoluteDir = path.join(root, relativeDir);
    let entries: string[];
    try {
      entries = readdirSync(absoluteDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relative = relativeDir ? path.join(relativeDir, entry) : entry;
      const absolute = path.join(root, relative);
      let stats;
      try {
        stats = statSync(absolute);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry)) stack.push(relative);
        continue;
      }
      if (!stats.isFile()) continue;
      if (EXCLUDED_FILES.has(entry)) continue;
      // Generated client output (e.g. prisma's src/generated) is not hand-authored.
      if (/(^|\/)generated\//.test(relative)) continue;
      let contents = "";
      try {
        contents = readFileSync(absolute, "utf8");
      } catch {
        continue;
      }
      const loc = contents.length === 0 ? 0 : contents.split("\n").length;
      files.push({ relative, bytes: stats.size, loc });
    }
  }
  return files;
}

/**
 * Whole-directory footprint: a `statSync`-only walk with **no exclusions** (the
 * `du` view — node_modules, build output and lockfiles included). No file reads,
 * so it stays cheap even over a populated node_modules tree.
 */
export function directoryFootprint(root: string): {
  files: number;
  bytes: number;
} {
  let files = 0;
  let bytes = 0;
  const stack = [""];
  while (stack.length > 0) {
    const relativeDir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(path.join(root, relativeDir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relative = relativeDir ? path.join(relativeDir, entry) : entry;
      let stats;
      try {
        stats = statSync(path.join(root, relative));
      } catch {
        continue;
      }
      if (stats.isDirectory()) stack.push(relative);
      else if (stats.isFile()) {
        files += 1;
        bytes += stats.size;
      }
    }
  }
  return { files, bytes };
}

/** Count direct dependencies from a manifest's contents (semantics unchanged). */
function countManifest(
  kind: DependencyManifest["kind"],
  contents: string,
): number {
  if (kind === "npm") {
    const parsed = JSON.parse(contents) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(parsed.dependencies ?? {}).length;
  }
  if (kind === "python") {
    const match = contents.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    return match ? (match[1]!.match(/"[^"]+"/g)?.length ?? 0) : 0;
  }
  // Elixir: the known `{:dep,` regex counts Phoenix framework deps too — that is
  // today's definition of "direct" for Elixir, unchanged by this discovery fix.
  return (contents.match(/\{:[a-z_]+/g) ?? []).length;
}

const MANIFEST_KINDS: Record<string, DependencyManifest["kind"]> = {
  "package.json": "npm",
  "pyproject.toml": "python",
  "mix.exs": "elixir",
};

/**
 * Discover every dependency manifest under `appDirectory` with a bounded depth
 * (plan D3), honouring the same exclusion discipline as the authored walk
 * (`EXCLUDED_DIRS`/`EXCLUDED_FILES`) — so `.next-e2e`, `node_modules` and
 * lockfiles are never counted. Only the app directory is walked; the repo root
 * never is. Counting semantics per manifest are unchanged.
 */
export function discoverDependencyManifests(
  appDirectory: string,
  maxDepth = 3,
): DependencyManifest[] {
  const manifests: DependencyManifest[] = [];
  const stack: Array<{ relativeDir: string; depth: number }> = [
    { relativeDir: "", depth: 0 },
  ];
  while (stack.length > 0) {
    const { relativeDir, depth } = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(path.join(appDirectory, relativeDir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relative = relativeDir ? path.join(relativeDir, entry) : entry;
      let stats;
      try {
        stats = statSync(path.join(appDirectory, relative));
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (depth < maxDepth && !EXCLUDED_DIRS.has(entry)) {
          stack.push({ relativeDir: relative, depth: depth + 1 });
        }
        continue;
      }
      if (!stats.isFile() || EXCLUDED_FILES.has(entry)) continue;
      const kind = MANIFEST_KINDS[entry];
      if (!kind) continue;
      let contents = "";
      try {
        contents = readFileSync(path.join(appDirectory, relative), "utf8");
      } catch {
        continue;
      }
      let directDependencies = 0;
      try {
        directDependencies = countManifest(kind, contents);
      } catch {
        directDependencies = 0;
      }
      manifests.push({ path: relative, kind, directDependencies });
    }
  }
  manifests.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return manifests;
}

/** Sum of direct dependencies across every discovered manifest (plan D3). */
export function countDirectDependencies(appDirectory: string): number {
  return discoverDependencyManifests(appDirectory).reduce(
    (total, manifest) => total + manifest.directDependencies,
    0,
  );
}

export function collectInventory(options: {
  variantId: string;
  appDirectory: string;
  serviceCount: number;
  imageCount: number;
}): StaticInventory {
  const source = emptyBucket();
  const tests = emptyBucket();
  const infrastructure = emptyBucket();

  for (const file of walk(options.appDirectory)) {
    const base = path.basename(file.relative);
    const ext = path.extname(file.relative).toLowerCase();
    const language = LANGUAGE_BY_EXT[ext] ?? "Other";
    if (INFRA_FILES.test(base))
      add(infrastructure, language, file.loc, file.bytes);
    else if (isTestPath(file.relative))
      add(tests, language, file.loc, file.bytes);
    else add(source, language, file.loc, file.bytes);
  }

  const languages = new Set([
    ...Object.keys(source.byLanguage),
    ...Object.keys(tests.byLanguage),
    ...Object.keys(infrastructure.byLanguage),
  ]).size;

  const dependencyManifests = discoverDependencyManifests(options.appDirectory);
  return {
    variantId: options.variantId,
    source,
    tests,
    infrastructure,
    dependencyManifests,
    directDependencies: dependencyManifests.reduce(
      (total, manifest) => total + manifest.directDependencies,
      0,
    ),
    languages,
    serviceCount: options.serviceCount,
    imageCount: options.imageCount,
    footprint: directoryFootprint(options.appDirectory),
  };
}
