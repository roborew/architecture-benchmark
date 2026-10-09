// CLI: validate rig configs and variant manifests without starting anything.
// Usage:
//   pnpm config:validate config/default.yaml
//   pnpm config:validate config/default.yaml manifests
//   pnpm config:validate config/default.yaml manifests/next-actions.yaml
//
// When no manifest paths are given, `manifests/` (relative to the rig package)
// is validated and cross-checked against the config's `variants:` list.

import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";
import {
  ConfigError,
  loadConfig,
  loadManifestDirectory,
  loadVariantManifest,
  effectiveRunManifest,
} from "./load.js";
import type { VariantManifest } from "./schema.js";

const rigRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

async function collectManifests(
  paths: string[],
): Promise<Map<string, VariantManifest>> {
  const manifests = new Map<string, VariantManifest>();
  for (const target of paths) {
    if (statSync(target).isDirectory()) {
      for (const [id, manifest] of await loadManifestDirectory(target)) {
        manifests.set(id, manifest);
      }
    } else {
      const manifest = await loadVariantManifest(target);
      if (manifests.has(manifest.id)) {
        throw new ConfigError(`duplicate manifest id '${manifest.id}'`, [
          target,
        ]);
      }
      manifests.set(manifest.id, manifest);
    }
  }
  return manifests;
}

async function main(): Promise<number> {
  const paths = argv.slice(2);
  if (paths.length === 0) {
    console.error(
      "usage: tsx src/config/validate.ts <config.yaml> [<manifest-dir-or-file> ...]",
    );
    return 2;
  }

  const [configPath, ...manifestPaths] = paths;
  if (configPath === undefined) {
    console.error(
      "usage: tsx src/config/validate.ts <config.yaml> [<manifest-dir-or-file> ...]",
    );
    return 2;
  }
  try {
    const config = await loadConfig(configPath);
    const effective = effectiveRunManifest(config);
    console.log(`ok: ${configPath}`);
    console.log(
      `  name=${config.name} variants=${config.variants.length} trials=${config.trials}`,
    );
    for (const scenario of config.scenarios) {
      console.log(`  scenario ${scenario.id} (${scenario.kind})`);
    }
    console.log(
      `  load.generatorMaxCpuPercent=${config.load.generatorMaxCpuPercent}`,
    );
    console.log(`  effective manifest sha256: ${effective.sha256}`);

    const manifests = await collectManifests(
      manifestPaths.length > 0
        ? manifestPaths
        : [path.join(rigRoot, "manifests")],
    );

    const byCohort = new Map<string, string[]>();
    for (const manifest of manifests.values()) {
      const list = byCohort.get(manifest.cohort) ?? [];
      list.push(manifest.id);
      byCohort.set(manifest.cohort, list);
    }
    for (const [cohort, ids] of [...byCohort.entries()].sort()) {
      console.log(`  cohort ${cohort}: ${ids.sort().join(", ")}`);
    }

    let failures = 0;
    for (const id of config.variants) {
      if (!manifests.has(id)) {
        console.error(
          `  error: config references variant '${id}' with no manifest`,
        );
        failures += 1;
      }
    }
    for (const id of manifests.keys()) {
      if (!config.variants.includes(id)) {
        console.warn(
          `  warning: manifest '${id}' is not listed in config variants`,
        );
      }
    }

    return failures === 0 ? 0 : 1;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`${err.message}`);
      for (const issue of err.issues) console.error(`  - ${issue}`);
      return 1;
    }
    throw err;
  }
}

exit(await main());
