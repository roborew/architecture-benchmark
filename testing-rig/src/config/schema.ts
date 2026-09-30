// Rig config + variant manifest schemas (plan §4). Zod validation with
// `.strict()` everywhere: unknown keys are rejected, not silently ignored.
//
// Semantics note (plan §4): `volume` scenarios request exact successful
// operation counts; `capacity` scenarios are rate ladders with operation
// weights. The illustrative single `workload:` mapping from the plan is NOT
// valid here — only the normative `scenarios:` shape is.

import { z } from "zod";

export const OPERATION_KINDS = ["list", "detail", "create", "update", "delete"] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

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
    message: "baseTimestamp must be ISO 8601 UTC at whole-second precision (YYYY-MM-DDTHH:MM:SSZ)",
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
      .object({ todo: positiveInt, doing: positiveInt, done: positiveInt })
      .strict()
      .refine((sp) => sp.todo + sp.doing + sp.done === 100, {
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
    viewport: z
      .object({ width: positiveInt, height: positiveInt })
      .strict(),
    cacheProfile: z.enum(["cold-browser-context"]),
    prefetch: z.enum(["disabled"]),
    operations: z.array(z.enum(OPERATION_KINDS)).min(1),
  })
  .strict();

export const volumeScenarioSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("volume"),
    counts: operationCounts.refine(
      (c) => Object.values(c).some((v) => v > 0),
      { message: "volume scenario must request at least one operation" },
    ),
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
  });

export type RigConfig = z.infer<typeof rigConfigSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type VolumeScenario = z.infer<typeof volumeScenarioSchema>;
export type CapacityScenario = z.infer<typeof capacityScenarioSchema>;

// ---------------------------------------------------------------------------
// Variant manifest (plan §4). Command arrays are a design shape only: the
// controller resolves app-relative paths and the unique Compose project name
// itself; it never executes an unvalidated shell string from YAML.

export const variantManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    appDirectory: z.string().min(1),
    composeFile: z.string().min(1),
    projectPrefix: z.string().min(1),
    healthPath: z.string().startsWith("/"),
    appHostPortEnv: z.string().min(1),
    composeServices: z
      .object({ app: z.string().min(1), db: z.string().min(1), seeder: z.string().min(1) })
      .strict(),
    seedCommand: z.array(z.string()).min(1),
    resetCommand: z.array(z.string()).min(1),
    capabilities: z
      .array(z.enum(["list", "detail", "create", "update", "delete", "create-with-comment"]))
      .min(1),
    readMode: z.string().min(1),
    mutationMode: z.string().min(1),
  })
  .strict();

export type VariantManifest = z.infer<typeof variantManifestSchema>;
