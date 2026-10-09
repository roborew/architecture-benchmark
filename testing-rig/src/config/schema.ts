// Rig config + variant manifest schemas (plan §4). Zod validation with
// `.strict()` everywhere: unknown keys are rejected, not silently ignored.
//
// Semantics note (plan §4): `volume` scenarios request exact successful
// operation counts; `capacity` scenarios are rate ladders with operation
// weights. The illustrative single `workload:` mapping from the plan is NOT
// valid here — only the normative `scenarios:` shape is.

import { z } from "zod";

export const OPERATION_KINDS = [
  "list",
  "detail",
  "create",
  "update",
  "delete",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** A capability is an operation *plus* the composite `create-with-comment`. */
export const CAPABILITY_KINDS = [
  ...OPERATION_KINDS,
  "create-with-comment",
] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/** The three cohorts the reports group by (plan §1.1/§4). */
export const COHORTS = ["next-fullstack", "tanstack-start", "spa-api"] as const;
export type Cohort = (typeof COHORTS)[number];

/** What a Compose service *is*, so the controller can plan ports/health. */
export const SERVICE_KINDS = ["app", "api", "spa", "db", "seeder"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

const positiveInt = z.number().int().positive();
const nonnegativeInt = z.number().int().nonnegative();

const operationCounts = z
  .object({
    list: nonnegativeInt,
    detail: nonnegativeInt,
    create: nonnegativeInt,
    update: nonnegativeInt,
    delete: nonnegativeInt,
  })
  .strict();

const baseTimestamp = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s), {
    message:
      "baseTimestamp must be ISO 8601 UTC at whole-second precision (YYYY-MM-DDTHH:MM:SSZ)",
  });

export const fixtureSchema = z
  .object({
    seedVersion: z.literal(1),
    seed: z.number().int(),
    projectCount: positiveInt,
    userCount: positiveInt,
    taskCount: positiveInt,
    commentCount: nonnegativeInt,
    baseTimestamp,
    statusPercent: z
      .object({
        todo: positiveInt,
        "in progress": positiveInt,
        done: positiveInt,
      })
      .strict()
      .refine((sp) => sp.todo + sp["in progress"] + sp.done === 100, {
        message: "statusPercent must sum to exactly 100",
      }),
    workingSetFraction: z.number().gt(0).lte(1),
  })
  .strict();

export const resetSchema = z
  .object({
    betweenPhases: z.boolean(),
    betweenTrials: z.boolean(),
    method: z.enum(["database-recreate"]),
  })
  .strict();

export const browserSchema = z
  .object({
    engine: z.literal("chromium"),
    workers: positiveInt,
    warmupSamples: nonnegativeInt,
    measuredSamples: positiveInt,
    viewport: z.object({ width: positiveInt, height: positiveInt }).strict(),
    cacheProfile: z.enum(["cold-browser-context"]),
    prefetch: z.enum(["disabled"]),
    operations: z.array(z.enum(OPERATION_KINDS)).min(1),
  })
  .strict();

/**
 * Load-generator limits (plan §6.5/§7). The generator-saturation rejection
 * criterion needs an explicit ceiling: a trial whose generator process burns
 * more than `generatorMaxCpuPercent` of a core while producing load is not a
 * measurement of the app and is rejected. Default 75 keeps every existing
 * config valid.
 */
export const loadSchema = z
  .object({
    generatorMaxCpuPercent: z.number().positive().max(100).default(75),
  })
  .strict();

export const volumeScenarioSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("volume"),
    counts: operationCounts.refine((c) => Object.values(c).some((v) => v > 0), {
      message: "volume scenario must request at least one operation",
    }),
    concurrency: positiveInt,
    maxAttemptsPerOperation: positiveInt,
    maxDurationSeconds: positiveInt,
    resetBefore: z.boolean(),
  })
  .strict();

export const capacityScenarioSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("capacity"),
    weights: operationCounts.refine(
      (w) => Object.values(w).some((v) => v > 0),
      { message: "capacity scenario must weight at least one operation" },
    ),
    ratesPerSecond: z.array(z.number().positive()).min(1),
    durationPerStepSeconds: positiveInt,
    preallocatedVUs: positiveInt,
    maxVUs: positiveInt,
    resetBefore: z.boolean(),
  })
  .strict();

export const scenarioSchema = z.discriminatedUnion("kind", [
  volumeScenarioSchema,
  capacityScenarioSchema,
]);

export const networkSchema = z
  .object({
    browserToAppAddedRttMs: z.number().nonnegative(),
    appToApiAddedRttMs: z.number().nonnegative(),
  })
  .strict();

export const resourcesSchema = z
  .object({
    appCpus: positiveInt,
    appMemoryMb: positiveInt,
    dbCpus: positiveInt,
    dbMemoryMb: positiveInt,
  })
  .strict();

export const reportSchema = z
  .object({
    keepRawSamples: z.boolean(),
    outputFormats: z.array(z.enum(["json", "csv", "html"])).min(1),
  })
  .strict();

export const rigConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    variants: z.array(z.string().min(1)).min(1),
    trials: positiveInt,
    variantOrder: z.enum(["rotate", "fixed"]),
    fixture: fixtureSchema,
    reset: resetSchema,
    browser: browserSchema,
    scenarios: z.array(scenarioSchema).min(1),
    network: networkSchema,
    resources: resourcesSchema,
    load: loadSchema.default({ generatorMaxCpuPercent: 75 }),
    report: reportSchema,
  })
  .strict()
  .superRefine((cfg, ctx) => {
    // Plan §7: the phase-1 cohort has no separate backend service, so
    // app-to-API latency cannot exist; reject rather than pretend.
    if (cfg.network.appToApiAddedRttMs !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["network", "appToApiAddedRttMs"],
        message:
          "phase-1 cohort has no separate backend service; appToApiAddedRttMs must be 0 (add a labelled profile when external backends exist)",
      });
    }

    // A variant listed twice would silently double its trials and confound the
    // rotated order; reject it at validation time.
    const seen = new Set<string>();
    for (const id of cfg.variants) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants"],
          message: `duplicate variant id '${id}'`,
        });
      }
      seen.add(id);
    }
  });

export type RigConfig = z.infer<typeof rigConfigSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type VolumeScenario = z.infer<typeof volumeScenarioSchema>;
export type CapacityScenario = z.infer<typeof capacityScenarioSchema>;

// ---------------------------------------------------------------------------
// Variant manifest, schema version 2 (plan §4).
//
// A manifest describes one variant as one Compose stack. Single-service
// variants have an `app`; `spa-api` pairs have an `api` and a `spa`. Every
// stack owns its `db` and a rig-supplied `seeder`. Command arrays are a design
// shape only: the controller resolves app-relative paths, the unique Compose
// project name, allocated ports, and `{{TOKEN}}` build args itself; it never
// executes an unvalidated shell string from YAML.

/**
 * A service the controller needs to know about. `healthPath`/`hostPortEnv`
 * are present exactly for the services that are published to the host and
 * polled for readiness (app/api/spa) — not for `db` (reached in-network) or
 * `seeder` (one-shot).
 */
export const serviceSchema = z
  .object({
    composeService: z.string().min(1),
    kind: z.enum(SERVICE_KINDS),
    healthPath: z.string().startsWith("/").optional(),
    hostPortEnv: z.string().min(1).optional(),
    /** Build-time args, values may contain `{{OTHER_HOST_PORT_ENV}}` tokens. */
    buildArgs: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type ServiceManifest = z.infer<typeof serviceSchema>;

const commandSchema = z
  .object({ command: z.array(z.string()).min(1) })
  .strict();

export type CommandManifest = z.infer<typeof commandSchema>;

/**
 * Read-only load targets (plan §6.5). The interim measurement the plan allows
 * until per-transport write adapters are validated: GET a set of read paths on
 * one published service.
 */
const manifestLoadSchema = z
  .object({
    service: z.enum(["app", "api", "spa"]),
    paths: z.array(z.string().startsWith("/")).min(1),
  })
  .strict();

export const variantManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: z.string().min(1),
    cohort: z.enum(COHORTS),
    appDirectory: z.string().min(1),
    composeFile: z.string().min(1),
    projectPrefix: z.string().min(1),
    services: z
      .object({
        app: serviceSchema.optional(),
        api: serviceSchema.optional(),
        spa: serviceSchema.optional(),
        db: serviceSchema,
        seeder: serviceSchema,
      })
      .strict(),
    seed: commandSchema,
    reset: commandSchema,
    /** Read-only load targets (plan §6.5 interim: read-only capacity, labelled). */
    load: manifestLoadSchema.optional(),
    capabilities: z.array(z.enum(CAPABILITY_KINDS)).min(1),
    readMode: z.string().min(1),
    mutationMode: z.string().min(1),
    orm: z.string().min(1),
  })
  .strict()
  .superRefine((m, ctx) => {
    const { app, api, spa, db, seeder } = m.services;

    const issue = (path: string, message: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: path.split("."),
        message,
      });

    // Shape: either one single `app`, or an `api` (optionally with a `spa`).
    if (app && api)
      issue("services", "a variant has either `app` or `api`, never both");
    if (!app && !api)
      issue("services", "a variant must declare `app` or `api`");
    if (spa && !api)
      issue("services.spa", "`spa` is only meaningful alongside `api`");
    if (app && spa)
      issue("services", "a single-service variant has no separate `spa`");

    // Kind must agree with the slot it is declared in.
    if (app && app.kind !== "app") issue("services.app.kind", "must be 'app'");
    if (api && api.kind !== "api") issue("services.api.kind", "must be 'api'");
    if (spa && spa.kind !== "spa") issue("services.spa.kind", "must be 'spa'");
    if (db.kind !== "db") issue("services.db.kind", "must be 'db'");
    if (seeder.kind !== "seeder")
      issue("services.seeder.kind", "must be 'seeder'");

    // Published services need both a health path and a host-port env, or
    // neither. db/seeder must have neither.
    for (const [name, svc] of Object.entries(m.services)) {
      if (!svc) continue;
      const published = name === "app" || name === "api" || name === "spa";
      if (published && (!svc.healthPath || !svc.hostPortEnv)) {
        issue(
          `services.${name}`,
          `${name} requires both healthPath and hostPortEnv`,
        );
      }
      if (!published && (svc.healthPath || svc.hostPortEnv)) {
        issue(
          `services.${name}`,
          `${name} must not declare healthPath or hostPortEnv`,
        );
      }
    }

    // Two published services must not reuse a host-port env.
    const envs = [app, api, spa]
      .filter((s): s is ServiceManifest => Boolean(s))
      .map((s) => s.hostPortEnv)
      .filter((e): e is string => Boolean(e));
    if (new Set(envs).size !== envs.length) {
      issue(
        "services",
        "published services must use distinct hostPortEnv names",
      );
    }

    // A load target must name a service the variant actually publishes.
    if (m.load) {
      const target =
        m.load.service === "app" ? app : m.load.service === "api" ? api : spa;
      if (!target) {
        issue(
          "load.service",
          `variant does not publish a '${m.load.service}' service`,
        );
      }
    }
  });

export type VariantManifest = z.infer<typeof variantManifestSchema>;
