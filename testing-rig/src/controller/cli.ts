// Controller entry point (plan §5). Usage:
//   pnpm rig:run --config config/smoke-matrix.yaml
//   pnpm rig:run --config config/default.yaml --only next-actions --no-build
//
// Serial by design (plan §7): one stack at a time on an idle host. Everything is
// written under `testing-rig/results/<run-id>/`.

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";
import {
  loadConfig,
  loadManifestDirectory,
  effectiveRunManifest,
  ConfigError,
} from "../config/load.js";
import type { RigConfig, VariantManifest } from "../config/schema.js";
import { RunArtifacts } from "./artifacts.js";
import { dockerAvailable, runCommand } from "./docker.js";
import { checkEligibility } from "./fixture.js";
import { runVariant, type VariantResult } from "./lifecycle.js";
import { planVariant, SEEDER_IMAGE } from "./plan.js";
import { collectInventory } from "../reporting/inventory.js";
import type { ResolvedVariant, ResourceCaps } from "./types.js";

const rigRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

interface Options {
  config: string;
  manifests: string;
  only?: string[];
  build: false | { noCache: boolean };
  buildSeeder: boolean;
  correctness: boolean;
  readinessTimeoutMs: number;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    config: path.join(rigRoot, "config", "default.yaml"),
    manifests: path.join(rigRoot, "manifests"),
    build: { noCache: false },
    buildSeeder: true,
    correctness: false,
    readinessTimeoutMs: 90_000,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--config":
        options.config = args[++i]!;
        break;
      case "--manifests":
        options.manifests = args[++i]!;
        break;
      case "--only":
        options.only = args[++i]!.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--no-build":
        options.build = false;
        break;
      case "--no-cache":
        options.build = { noCache: true };
        break;
      case "--skip-seeder-build":
        options.buildSeeder = false;
        break;
      case "--with-correctness":
        options.correctness = true;
        break;
      case "--readiness-timeout":
        options.readinessTimeoutMs = Number(args[++i]);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function resourcesOf(config: RigConfig): ResourceCaps {
  return {
    appCpus: config.resources.appCpus,
    appMemoryMb: config.resources.appMemoryMb,
    dbCpus: config.resources.dbCpus,
    dbMemoryMb: config.resources.dbMemoryMb,
  };
}

/** Refuse impossible plans before any image is built (plan §5). */
function preflight(
  config: RigConfig,
  manifests: Map<string, VariantManifest>,
): string[] {
  const problems: string[] = [];
  for (const id of config.variants) {
    if (!manifests.has(id))
      problems.push(`config references '${id}' but no manifest exists`);
  }
  for (const scenario of config.scenarios) {
    if (scenario.kind !== "volume") continue;
    const result = checkEligibility(config.fixture, {
      updates: scenario.counts.update,
      deletes: scenario.counts.delete,
    });
    if (!result.ok) {
      for (const reason of result.reasons)
        problems.push(`scenario '${scenario.id}': ${reason}`);
    }
  }
  return problems;
}

async function gitRevision(): Promise<string> {
  const result = await runCommand("git", ["rev-parse", "HEAD"], {
    allowFailure: true,
    cwd: rigRoot,
  });
  return result.code === 0 ? result.stdout.trim() : "unknown";
}

async function main(): Promise<number> {
  const options = parseArgs(argv.slice(2));

  const config = await loadConfig(options.config);
  const allManifests = await loadManifestDirectory(options.manifests);
  const selected = options.only
    ? config.variants.filter((id) => options.only!.includes(id))
    : config.variants;

  const problems = preflight(config, allManifests);
  if (problems.length > 0) {
    console.error("preflight failed:");
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }

  if (!(await dockerAvailable())) {
    console.error("preflight failed: the Docker daemon is not reachable");
    return 1;
  }

  // Compose project names allow only lowercase alphanumerics, `-`, `_` and
  // must start with an alphanumeric. Build the run id accordingly.
  const runId = new Date().toISOString().replace(/[:.]/g, "-").toLowerCase();
  const artifacts = new RunArtifacts(path.join(rigRoot, "results", runId));
  const effective = effectiveRunManifest(config);
  artifacts.write("effective-config.yaml", effective.yaml);
  artifacts.writeJson("preflight.json", {
    runId,
    gitRevision: await gitRevision(),
    config: options.config,
    selected,
    effectiveManifestSha256: effective.sha256,
  });

  console.log(
    `run ${runId}: ${selected.length} variant(s), ${config.trials} trial(s)`,
  );
  console.log(`  effective manifest sha256: ${effective.sha256}`);

  if (options.build !== false && options.buildSeeder) {
    console.log(`building ${SEEDER_IMAGE} …`);
    await runCommand(
      "docker",
      ["build", "-t", SEEDER_IMAGE, path.join(rigRoot, "seeder")],
      {
        timeoutMs: 30 * 60 * 1000,
      },
    );
  }

  const resources = resourcesOf(config);
  const variants: ResolvedVariant[] = [];
  for (const id of selected) {
    variants.push(
      await planVariant(allManifests.get(id)!, { rigRoot, runId, resources }),
    );
  }
  artifacts.writeJson(
    "run-manifest.json",
    variants.map((v) => ({
      id: v.id,
      cohort: v.cohort,
      projectName: v.projectName,
      composeFile: v.composeFile,
      ports: Object.fromEntries(
        v.published.map((s) => [s.hostPortEnv, s.hostPort]),
      ),
    })),
  );

  // Static & complexity inventory (plan §6.1), collected once per run.
  artifacts.writeJson(
    "inventory.json",
    variants.map((v) =>
      collectInventory({
        variantId: v.id,
        appDirectory: v.appDirectory,
        serviceCount: Object.values(v.services).filter(Boolean).length,
        // built images (app/api/spa) + postgres + the shared seeder.
        imageCount:
          (v.services.app ? 1 : 0) +
          (v.services.api ? 1 : 0) +
          (v.services.spa ? 1 : 0) +
          2,
      }),
    ),
  );

  const results: VariantResult[] = [];
  for (const variant of variants) {
    console.log(`\n=== ${variant.id} (${variant.cohort}) ===`);
    const result = await runVariant(variant, {
      rigRoot,
      resources,
      fixture: config.fixture,
      artifacts,
      build: options.build,
      correctness: options.correctness,
      readinessTimeoutMs: options.readinessTimeoutMs,
    });
    results.push(result);
    console.log(
      `  ${result.status} ${result.performanceEligible ? "(perf-eligible)" : ""}`,
    );
    for (const [name, stage] of Object.entries(result.stages)) {
      console.log(`    ${stage.ok ? "ok  " : "FAIL"} ${name} ${stage.ms}ms`);
    }
    if (result.error) console.log(`    error: ${result.error}`);
  }

  artifacts.writeJson("summary.json", {
    runId,
    effectiveManifestSha256: effective.sha256,
    results: results.map((r) => ({
      id: r.id,
      cohort: r.cohort,
      status: r.status,
      performanceEligible: r.performanceEligible,
      ports: r.ports,
      stages: Object.fromEntries(
        Object.entries(r.stages).map(([k, s]) => [k, { ok: s.ok, ms: s.ms }]),
      ),
      error: r.error ?? null,
    })),
    digest: createHash("sha256").update(JSON.stringify(results)).digest("hex"),
  });

  const failed = results.filter((r) => r.status !== "ok");
  console.log(
    `\n${results.length - failed.length}/${results.length} variants ok`,
  );
  console.log(`artefacts: ${artifacts.dir}`);
  return failed.length === 0 ? 0 : 1;
}

try {
  exit(await main());
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    for (const issue of err.issues) console.error(`  - ${issue}`);
    exit(1);
  }
  console.error(
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
  exit(1);
}
