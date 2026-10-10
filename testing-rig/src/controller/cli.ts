// Controller entry point (plan §5). Usage:
//   pnpm rig:run --config config/medium-2c2g.yaml
//   pnpm rig:run --config config/small-1c1g.yaml --only next-actions --no-build
//   pnpm rig:matrix                       # whole load × resource matrix (see matrix.ts)
//
// Serial by design (plan §7): one stack at a time on an idle host. Everything is
// written under `testing-rig/results/<run-id>/`.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
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
import { checkEligibility, eligibilityPools } from "./fixture.js";
import { runVariant, type VariantResult } from "./lifecycle.js";
import { planVariant, SEEDER_IMAGE } from "./plan.js";
import { parseResourcesSpec } from "./resources.js";
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
  render: boolean;
  load: boolean;
  /** Raw `--resources <spec>`; `BENCH_RESOURCES` is the env fallback. */
  resources?: string;
  readinessTimeoutMs: number;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    config: path.join(rigRoot, "config", "medium-2c2g.yaml"),
    manifests: path.join(rigRoot, "manifests"),
    build: { noCache: false },
    buildSeeder: true,
    correctness: false,
    render: false,
    load: false,
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
      case "--with-render":
        options.render = true;
        break;
      case "--with-load":
        options.load = true;
        break;
      case "--resources":
        options.resources = args[++i]!;
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

  // Config-driven stage selection (plan D4): the YAML decides which stages run,
  // and the CLI `--with-*` flags remain as one-off *upward* overrides. The
  // effective selection is recorded in preflight.json (plan D1) so the viewer
  // can tell "not requested" apart from "attempted and failed".
  const stages = {
    correctness: config.stages.correctness || options.correctness,
    render: config.stages.render || options.render,
    load: config.stages.load || options.load,
  };

  // Resource envelope override (plan R1), applied to the parsed config *before*
  // `effectiveRunManifest` hashing so provenance reflects the envelope. The CLI
  // flag wins over `BENCH_RESOURCES` when both are set.
  const originalCpus = config.resources.appCpus;
  const resourceSpec = options.resources ?? process.env.BENCH_RESOURCES;
  let resourcesRequested: Record<string, unknown> | null = null;
  if (resourceSpec) {
    let parsed;
    try {
      parsed = parseResourcesSpec(resourceSpec, resourcesOf(config));
    } catch (err) {
      console.error(
        `invalid --resources: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 2;
    }
    Object.assign(config.resources, parsed.resources);
    resourcesRequested = { ...parsed.requested, overridden: true };
  }

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

  // The Playwright stages drive Playwright's own pinned Chromium — never a
  // system Chrome — so a fresh machine only needs it downloaded once into the
  // shared browser cache. `playwright install` is a quick no-op when present,
  // so ensure it here rather than letting every variant build, seed, and then
  // fail at browser launch. Truly bare Linux hosts may also need the OS
  // libraries: `pnpm e2e:install` (runs `sudo apt-get` under the hood).
  if (stages.correctness || stages.render) {
    const { chromium } = await import("@playwright/test");
    if (!existsSync(chromium.executablePath())) {
      console.log("Playwright chromium missing — downloading (one-time) …");
      const installed = spawnSync(
        "pnpm",
        ["exec", "playwright", "install", "chromium"],
        { cwd: rigRoot, stdio: "inherit", timeout: 10 * 60 * 1000 },
      );
      if (installed.status !== 0) {
        console.error(
          "preflight failed: could not install Playwright chromium " +
            "(no network? run 'pnpm e2e:install' manually)",
        );
        if (installed.error) console.error(`  - ${installed.error.message}`);
        return 1;
      }
    }
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
    // Effective stage selection (plan D1): lets the viewer distinguish "not
    // requested" from "attempted and failed". `only` explains partial runs.
    stages,
    only: options.only ?? null,
    ...(resourcesRequested ? { resourcesRequested } : {}),
  });

  console.log(
    `run ${runId}: ${selected.length} variant(s), ${config.trials} trial(s)`,
  );
  console.log(`  effective manifest sha256: ${effective.sha256}`);
  if (resourcesRequested) {
    console.log(
      `  resource envelope: app ${config.resources.appCpus} CPU / ${config.resources.appMemoryMb} MB, ` +
        `db ${config.resources.dbCpus} CPU / ${config.resources.dbMemoryMb} MB (overridden)`,
    );
    if (originalCpus !== config.resources.appCpus) {
      console.log(
        `  load VUs pinned to the config's appCpus (${originalCpus}) — same offered load, different hardware (plan R2)`,
      );
    }
  }

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
  const volumeScenario = config.scenarios.find((s) => s.kind === "volume");
  const capacityScenario = config.scenarios.find((s) => s.kind === "capacity");
  // Under an envelope override the closed-loop load legs would otherwise scale
  // with the hardware; pin VUs to the config's original appCpus so the offered
  // load is held constant (plan R2, option b). The K3 capacity ladder is
  // rate-defined and is therefore the primary cross-envelope instrument.
  const vuCpus = resourcesRequested ? originalCpus : config.resources.appCpus;
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
      keepRawSamples: config.report.keepRawSamples,
      correctness: stages.correctness,
      render: stages.render
        ? {
            warmup: config.browser.warmupSamples,
            measured: config.browser.measuredSamples,
          }
        : undefined,
      load: stages.load
        ? {
            vus: vuCpus * 2,
            durationSeconds: 15,
            generatorMaxCpuPercent: config.load.generatorMaxCpuPercent,
            ...(volumeScenario
              ? {
                  mutations: {
                    counts: volumeScenario.counts,
                    pools: {
                      updateFrom: eligibilityPools(config.fixture).updatePool
                        .from,
                      updateTo: eligibilityPools(config.fixture).updatePool.to,
                      deleteFrom: eligibilityPools(config.fixture).deletePool
                        .from,
                      deleteTo: eligibilityPools(config.fixture).deletePool.to,
                    },
                    readPaths: variant.load?.paths ?? [],
                  },
                }
              : {}),
            ...(capacityScenario
              ? { capacity: { scenario: capacityScenario } }
              : {}),
          }
        : undefined,
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

  // Refresh the consolidated results viewer so a bookmarked page always shows
  // the run that just finished. Reporting must never affect the run's status.
  try {
    const { writeViewer } = await import("../reporting/viewer-cli.js");
    const viewer = await writeViewer(path.join(rigRoot, "results"));
    console.log(`results viewer: ${viewer.count} run(s) → ${viewer.file}`);
  } catch (err) {
    console.warn(
      `results viewer not refreshed (run unaffected): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

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
