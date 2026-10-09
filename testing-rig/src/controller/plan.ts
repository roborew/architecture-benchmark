// Resolve a manifest into a runnable stack (plan §5): absolute paths, a run-
// unique Compose project name, allocated host ports, and `{{TOKEN}}` build args
// resolved. Pure-ish: the only side effect is asking the kernel for free ports.

import path from "node:path";
import type { VariantManifest } from "../config/schema.js";
import { allocateHostPorts } from "./ports.js";
import { resolveTokenMap } from "./tokens.js";
import type {
  ResolvedService,
  ResolvedVariant,
  ResourceCaps,
} from "./types.js";

export interface PlanOptions {
  /** Absolute path to the `testing-rig/` package root (manifests are `../apps`). */
  rigRoot: string;
  runId: string;
  resources: ResourceCaps;
}

const SEEDER_IMAGE = "bench-seeder:local";
export const POSTGRES_URL_IN_STACK = "postgresql://bench:bench@db:5432/bench";

function slots(manifest: VariantManifest): Array<"app" | "api" | "spa"> {
  const order: Array<"app" | "api" | "spa"> = [];
  if (manifest.services.app) order.push("app");
  if (manifest.services.api) order.push("api");
  if (manifest.services.spa) order.push("spa");
  return order;
}

export async function planVariant(
  manifest: VariantManifest,
  options: PlanOptions,
): Promise<ResolvedVariant> {
  const publishedSlots = slots(manifest);
  const envNames = publishedSlots.map(
    (slot) => manifest.services[slot]!.hostPortEnv!,
  );
  const ports = await allocateHostPorts(envNames);

  const resolve = (
    slot: "app" | "api" | "spa" | "db" | "seeder",
  ): ResolvedService => {
    const svc = manifest.services[slot]!;
    const hostPort = svc.hostPortEnv ? ports[svc.hostPortEnv] : undefined;
    return {
      slot,
      composeService: svc.composeService,
      kind: svc.kind,
      ...(svc.healthPath ? { healthPath: svc.healthPath } : {}),
      ...(svc.hostPortEnv ? { hostPortEnv: svc.hostPortEnv } : {}),
      ...(hostPort !== undefined ? { hostPort } : {}),
      ...(svc.buildArgs
        ? { buildArgs: resolveTokenMap(svc.buildArgs, ports) }
        : {}),
    };
  };

  const app = manifest.services.app ? resolve("app") : undefined;
  const api = manifest.services.api ? resolve("api") : undefined;
  const spa = manifest.services.spa ? resolve("spa") : undefined;
  const db = resolve("db");
  const seeder = resolve("seeder");

  const published = publishedSlots
    .map((slot) => (slot === "app" ? app! : slot === "api" ? api! : spa!))
    .filter(Boolean);

  return {
    id: manifest.id,
    cohort: manifest.cohort,
    appDirectory: path.resolve(options.rigRoot, manifest.appDirectory),
    composeFile: path.resolve(options.rigRoot, manifest.composeFile),
    projectName: `${manifest.projectPrefix}-${options.runId}`,
    services: {
      ...(app ? { app } : {}),
      ...(api ? { api } : {}),
      ...(spa ? { spa } : {}),
      db,
      seeder,
    },
    published,
    seedCommand: [...manifest.seed.command],
    resetCommand: [...manifest.reset.command],
    capabilities: [...manifest.capabilities],
    readMode: manifest.readMode,
    mutationMode: manifest.mutationMode,
    orm: manifest.orm,
  };
}

/**
 * The Compose environment for a variant's stack: allocated ports (as the
 * manifest's `hostPortEnv` names), resource caps, the in-stack Postgres URL,
 * and — for `spa-api` — the SPA origin the API must allow via CORS.
 */
export function composeEnv(
  variant: ResolvedVariant,
  resources: ResourceCaps,
): Record<string, string> {
  const env: Record<string, string> = {
    POSTGRES_URL: POSTGRES_URL_IN_STACK,
    APP_CPUS: String(resources.appCpus),
    APP_MEMORY_MB: String(resources.appMemoryMb),
    DB_CPUS: String(resources.dbCpus),
    DB_MEMORY_MB: String(resources.dbMemoryMb),
  };
  for (const service of variant.published) {
    if (service.hostPortEnv && service.hostPort !== undefined) {
      env[service.hostPortEnv] = String(service.hostPort);
    }
    // Build args (e.g. the SPA's VITE_API_URL) are passed to Compose by name and
    // referenced in the compose file under `build.args`.
    for (const [key, value] of Object.entries(service.buildArgs ?? {})) {
      env[key] = value;
    }
  }
  if (variant.services.spa?.hostPort !== undefined) {
    env.CORS_ORIGIN = `http://localhost:${variant.services.spa.hostPort}`;
  }
  return env;
}

export { SEEDER_IMAGE };
