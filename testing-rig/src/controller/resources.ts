// Resource-envelope override parsing (plan R1). The override is folded into the
// parsed config *before* `effectiveRunManifest` hashing, so `effective-config.yaml`
// and `effectiveManifestSha256` reflect the envelope the run actually used.
//
// Two forms:
//   envelope: `cpus=2,memoryMb=2048`                      → all four fields
//   granular: `appCpus=2,appMemoryMb=2048,dbCpus=1,dbMemoryMb=1024`
//
// Unknown keys, non-integer / non-positive values, and mixing the two forms are
// rejected (strictness discipline, same as the YAML `resources:` block).

import type { ResourceCaps } from "./types.js";

const GRANULAR_KEYS = [
  "appCpus",
  "appMemoryMb",
  "dbCpus",
  "dbMemoryMb",
] as const;
const ENVELOPE_KEYS = ["cpus", "memoryMb"] as const;

export interface ParsedResources {
  /** The raw requested key→value pairs (recorded verbatim in preflight.json). */
  requested: Record<string, number>;
  /** The resulting four-field envelope to inject into the stack. */
  resources: ResourceCaps;
}

const isKnownKey = (key: string): boolean =>
  (GRANULAR_KEYS as readonly string[]).includes(key) ||
  (ENVELOPE_KEYS as readonly string[]).includes(key);

/**
 * Parse a resource spec against a base envelope. Granular keys may be given
 * partially (unspecified fields keep the base value); the envelope form requires
 * both `cpus` and `memoryMb`.
 */
export function parseResourcesSpec(
  spec: string,
  base: ResourceCaps,
): ParsedResources {
  const requested: Record<string, number> = {};
  for (const segment of spec.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0)
      throw new Error(
        `invalid --resources segment '${trimmed}' (expected key=value)`,
      );
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    if (!isKnownKey(key))
      throw new Error(
        `unknown --resources key '${key}' (expected cpus, memoryMb, ${GRANULAR_KEYS.join(", ")})`,
      );
    if (key in requested) throw new Error(`duplicate --resources key '${key}'`);
    if (!/^\d+$/.test(rawValue) || Number(rawValue) <= 0)
      throw new Error(`--resources ${key} must be a positive integer`);
    requested[key] = Number(rawValue);
  }
  if (Object.keys(requested).length === 0)
    throw new Error("--resources is empty (expected key=value pairs)");

  const hasEnvelope = ENVELOPE_KEYS.some((key) => key in requested);
  const hasGranular = GRANULAR_KEYS.some((key) => key in requested);
  if (hasEnvelope && hasGranular)
    throw new Error(
      "--resources cannot mix the envelope (cpus/memoryMb) and granular key forms",
    );

  if (hasEnvelope) {
    if (!("cpus" in requested) || !("memoryMb" in requested))
      throw new Error(
        "--resources envelope form requires both cpus and memoryMb",
      );
    const cpus = requested.cpus!;
    const memoryMb = requested.memoryMb!;
    return {
      requested,
      resources: {
        appCpus: cpus,
        appMemoryMb: memoryMb,
        dbCpus: cpus,
        dbMemoryMb: memoryMb,
      },
    };
  }

  return {
    requested,
    resources: {
      appCpus: requested.appCpus ?? base.appCpus,
      appMemoryMb: requested.appMemoryMb ?? base.appMemoryMb,
      dbCpus: requested.dbCpus ?? base.dbCpus,
      dbMemoryMb: requested.dbMemoryMb ?? base.dbMemoryMb,
    },
  };
}
