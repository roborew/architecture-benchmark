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
  if (/(^|\/)(tests|test|__tests__|e2e|integration)\//.test(relative)) return true;
  return /\.(test|spec|integration)\.[cm]?[jt]sx?$/.test(relative) || /(^|\/)(test_.*|.*_test)\.py$/.test(relative);
}

type LanguageTotals = { files: number; loc: number; bytes: number };

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
  directDependencies: number;
  languages: number;
  serviceCount: number;
  imageCount: number;
}

function emptyBucket(): InventoryBucket {
  return { files: 0, loc: 0, bytes: 0, byLanguage: {} };
}

function add(bucket: InventoryBucket, language: string, loc: number, bytes: number): void {
  bucket.files += 1;
  bucket.loc += loc;
  bucket.bytes += bytes;
  const entry = (bucket.byLanguage[language] ??= { files: 0, loc: 0, bytes: 0 });
  entry.files += 1;
  entry.loc += loc;
  entry.bytes += bytes;
}

function walk(root: string): Array<{ relative: string; bytes: number; loc: number }> {
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

/** Count direct dependencies from whichever manifest the variant uses. */
export function countDirectDependencies(appDirectory: string): number {
  const readIf = (name: string): string | undefined => {
    try {
      return readFileSync(path.join(appDirectory, name), "utf8");
    } catch {
      return undefined;
    }
  };

  const pkg = readIf("package.json");
  if (pkg) {
    const parsed = JSON.parse(pkg) as { dependencies?: Record<string, string> };
    return Object.keys(parsed.dependencies ?? {}).length;
  }

  const pyproject = readIf("pyproject.toml");
  if (pyproject) {
    const match = pyproject.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    return match ? (match[1]!.match(/"[^"]+"/g)?.length ?? 0) : 0;
  }

  const mix = readIf("mix.exs");
  if (mix) {
    return (mix.match(/\{:[a-z_]+/g) ?? []).length;
  }

  return 0;
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
    if (INFRA_FILES.test(base)) add(infrastructure, language, file.loc, file.bytes);
    else if (isTestPath(file.relative)) add(tests, language, file.loc, file.bytes);
    else add(source, language, file.loc, file.bytes);
  }

  const languages = new Set([
    ...Object.keys(source.byLanguage),
    ...Object.keys(tests.byLanguage),
    ...Object.keys(infrastructure.byLanguage),
  ]).size;

  return {
    variantId: options.variantId,
    source,
    tests,
    infrastructure,
    directDependencies: countDirectDependencies(options.appDirectory),
    languages,
    serviceCount: options.serviceCount,
    imageCount: options.imageCount,
  };
}
