// The per-variant lifecycle state machine (plan §5/§6). One variant = one
// Compose stack. Every stage is timed and recorded; teardown runs in `finally`
// so a failure never leaves containers, networks, or volumes behind, and the
// failure artefacts are written on the way out.

import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runCommand, type Compose } from "./docker.js";
import { SEEDER_IMAGE, composeEnv } from "./plan.js";
import { Compose as ComposeClass } from "./docker.js";
import { verifyDigest, verifySchema } from "./verify.js";
import type { FixtureParams } from "./fixture.js";
import type { ResolvedVariant, ResourceCaps } from "./types.js";
import type { RunArtifacts } from "./artifacts.js";

export interface StageRecord {
  ok: boolean;
  ms: number;
  detail?: unknown;
}

export interface SeederReport {
  mode: string;
  profile?: string;
  rowCounts?: Record<string, number>;
  combinedSha256?: string;
  expectedCombinedSha256?: string;
  digestMatches?: boolean;
  rowCountsMatch?: boolean;
  eligibility?: unknown;
}

export interface VariantResult {
  id: string;
  cohort: string;
  status: "ok" | "failed";
  performanceEligible: boolean;
  ports: Record<string, number>;
  stages: Record<string, StageRecord>;
  error?: string;
}

export interface LifecycleOptions {
  rigRoot: string;
  resources: ResourceCaps;
  fixture: FixtureParams;
  artifacts: RunArtifacts;
  /** `false` skips builds entirely; `{noCache:true}` forces a cold build. */
  build?: false | { noCache?: boolean };
  /** Build `bench-seeder:local` before the stack images (once per run). */
  buildSeeder?: boolean;
  readinessTimeoutMs?: number;
}

export function composeFor(
  variant: ResolvedVariant,
  resources: ResourceCaps,
): ComposeClass {
  return new ComposeClass({
    projectName: variant.projectName,
    files: [variant.composeFile],
    cwd: variant.appDirectory,
    env: composeEnv(variant, resources),
  });
}

export function portsOf(variant: ResolvedVariant): Record<string, number> {
  const ports: Record<string, number> = {};
  for (const service of variant.published) {
    if (service.hostPortEnv && service.hostPort !== undefined) {
      ports[service.hostPortEnv] = service.hostPort;
    }
  }
  return ports;
}

async function waitForHealthy(
  variant: ResolvedVariant,
  timeoutMs: number,
): Promise<Record<string, { status: number; ms: number }>> {
  const deadline = Date.now() + timeoutMs;
  const report: Record<string, { status: number; ms: number }> = {};

  for (const service of variant.published) {
    const url = `http://localhost:${service.hostPort}${service.healthPath}`;
    const startedAt = Date.now();
    let lastError = "not attempted";
    for (;;) {
      try {
        const response = await fetch(url, { redirect: "manual" });
        if (response.ok) {
          // The contract's /healthz returns {"ok":true}; a 200 with ok:false is
          // not healthy. The static SPA's `/` is HTML, so only JSON is checked.
          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const body = (await response.json()) as { ok?: boolean };
            if (body.ok === false)
              throw new Error(`health body says ok:false (${url})`);
          }
          report[service.slot] = {
            status: response.status,
            ms: Date.now() - startedAt,
          };
          break;
        }
        lastError = `HTTP ${response.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `${service.slot} not healthy at ${url} within ${timeoutMs}ms: ${lastError}`,
        );
      }
      await delay(500);
    }
  }
  return report;
}

/** Execute a manifest's seeder command shape against the resolved stack. */
async function runSeeder(
  compose: Compose,
  variant: ResolvedVariant,
  mode: "seed" | "reset" | "verify",
  fixture: FixtureParams | undefined,
  command: string[],
): Promise<SeederReport> {
  const seederService = variant.services.seeder.composeService;
  // Command arrays are a design shape (plan §4); validate shape, don't execute
  // the array literally. Expected: [compose, run, --rm, <seeder>, <mode>].
  if (
    command[0] !== "compose" ||
    command[1] !== "run" ||
    command.at(-1) !== mode
  ) {
    throw new Error(
      `unexpected seeder command shape for '${mode}': ${command.join(" ")}`,
    );
  }

  const env: Record<string, string> =
    mode === "seed" && fixture ? { SEED_FIXTURE: JSON.stringify(fixture) } : {};
  const result = await compose.runService(seederService, [mode], { env });
  const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
  if (!line)
    throw new Error(`seeder ${mode} produced no output: ${result.stderr}`);
  const report = JSON.parse(line) as SeederReport;
  if (mode === "seed" && (!report.digestMatches || !report.rowCountsMatch)) {
    throw new Error(`seeder ${mode} self-check failed: ${line}`);
  }
  return report;
}

async function buildStack(
  variant: ResolvedVariant,
  compose: Compose,
  options: LifecycleOptions,
): Promise<unknown> {
  if (options.buildSeeder) {
    await runCommand(
      "docker",
      ["build", "-t", SEEDER_IMAGE, path.join(options.rigRoot, "seeder")],
      {
        timeoutMs: 30 * 60 * 1000,
      },
    );
  }

  const noCache = options.build !== false && options.build?.noCache;
  const built = await compose.build({ noCache });
  const images = await compose.images();
  return { buildMs: built.durationMs, imagesJson: images.stdout.trim() };
}

export async function runVariant(
  variant: ResolvedVariant,
  options: LifecycleOptions,
): Promise<VariantResult> {
  const compose = composeFor(variant, options.resources);
  const stages: Record<string, StageRecord> = {};
  const ports = portsOf(variant);
  const base = { id: variant.id, cohort: variant.cohort, ports };

  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      const detail = await fn();
      stages[name] = { ok: true, ms: Date.now() - startedAt, detail };
      return detail;
    } catch (err) {
      stages[name] = {
        ok: false,
        ms: Date.now() - startedAt,
        detail: err instanceof Error ? err.message : String(err),
      };
      throw err;
    }
  };

  let result: VariantResult;
  try {
    if (options.build !== false) {
      await stage("build", () => buildStack(variant, compose, options));
    }
    await stage("up", () => compose.up());
    await stage("ready", () =>
      waitForHealthy(variant, options.readinessTimeoutMs ?? 90_000),
    );
    await stage("reset", () =>
      runSeeder(compose, variant, "reset", undefined, variant.resetCommand),
    );
    const seed = await stage("seed", () =>
      runSeeder(compose, variant, "seed", options.fixture, variant.seedCommand),
    );
    const schema = await stage("verifySchema", () => verifySchema(compose));
    const digest = await stage("verifyDigest", () =>
      verifyDigest(compose, (seed as SeederReport).combinedSha256),
    );

    const eligible = schema.ok && (digest.matches ?? false);
    result = {
      ...base,
      status: eligible ? "ok" : "failed",
      performanceEligible: eligible,
      stages,
      ...(eligible ? {} : { error: "schema/digest verification failed" }),
    };
  } catch (err) {
    result = {
      ...base,
      status: "failed",
      performanceEligible: false,
      stages,
      error: err instanceof Error ? err.message : String(err),
    };
    const logs = await compose.logs();
    options.artifacts.write(
      `variants/${variant.id}/failure.log`,
      `${logs.stdout}${logs.stderr}`,
    );
  } finally {
    const startedAt = Date.now();
    const down = await compose.down({ volumes: true, removeOrphans: true });
    stages.teardown = { ok: down.code === 0, ms: Date.now() - startedAt };
    result ??= {
      ...base,
      status: "failed",
      performanceEligible: false,
      stages,
      error: "aborted",
    };
    result.stages = stages;
    options.artifacts.writeJson(
      `variants/${variant.id}/lifecycle.json`,
      result,
    );
  }

  return result;
}
