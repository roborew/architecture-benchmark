// Load + validate YAML configs and manifests; resolve the effective run
// manifest. The controller saves the effective manifest before running and
// embeds its hash into results (plan §4/§6).

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  rigConfigSchema,
  variantManifestSchema,
  type RigConfig,
  type VariantManifest,
} from "./schema.js";

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

function fail(path: string, error: unknown): never {
  if (error instanceof ConfigError) throw error;
  const issues =
    typeof error === "object" && error !== null && "issues" in error
      ? (
          error as {
            issues: Array<{ path: (string | number)[]; message: string }>;
          }
        ).issues.map((i) => `${i.path.join(".")}: ${i.message}`)
      : [String(error)];
  throw new ConfigError(`invalid config: ${path}`, issues);
}

export async function loadConfig(path: string): Promise<RigConfig> {
  let doc: unknown;
  try {
    doc = YAML.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new ConfigError(`cannot parse YAML: ${path}`, [String(err)]);
  }
  try {
    return rigConfigSchema.parse(doc);
  } catch (err) {
    fail(path, err);
  }
}

export async function loadVariantManifest(
  manifestPath: string,
): Promise<VariantManifest> {
  let doc: unknown;
  try {
    doc = YAML.parse(await readFile(manifestPath, "utf8"));
  } catch (err) {
    throw new ConfigError(`cannot parse YAML: ${manifestPath}`, [String(err)]);
  }
  try {
    return variantManifestSchema.parse(doc);
  } catch (err) {
    fail(manifestPath, err);
  }
}

/**
 * Load every `*.yaml` manifest in a directory, keyed by `manifest.id`.
 *
 * The controller resolves a config's `variants:` against this map, so a config
 * can never silently reference a variant whose manifest does not exist (or was
 * renamed) — it fails during preflight, before any image is built.
 */
export async function loadManifestDirectory(
  directory: string,
): Promise<Map<string, VariantManifest>> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (err) {
    throw new ConfigError(`cannot read manifest directory: ${directory}`, [
      String(err),
    ]);
  }

  const manifests = new Map<string, VariantManifest>();
  for (const entry of entries
    .filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"))
    .sort()) {
    const manifest = await loadVariantManifest(path.join(directory, entry));
    if (manifests.has(manifest.id)) {
      throw new ConfigError(
        `duplicate manifest id '${manifest.id}' in ${directory}`,
        [entry],
      );
    }
    manifests.set(manifest.id, manifest);
  }
  if (manifests.size === 0) {
    throw new ConfigError(`no manifests found in ${directory}`, []);
  }
  return manifests;
}

/** Canonical serialization + hash of the resolved (immutable) run manifest. */
export function effectiveRunManifest(config: RigConfig): {
  yaml: string;
  sha256: string;
} {
  const yaml = YAML.stringify(config, { sortMapEntries: true, lineWidth: 120 });
  return { yaml, sha256: createHash("sha256").update(yaml).digest("hex") };
}
