// CLI: validate rig configs and variant manifests without starting anything.
// Usage:
//   pnpm config:validate config/default.yaml
//   pnpm config:validate config/default.yaml manifests/template-next.yaml

import {
  ConfigError,
  loadConfig,
  loadVariantManifest,
  effectiveRunManifest,
} from "./load.js";
import { argv, exit } from "node:process";

async function main(): Promise<number> {
  const paths = argv.slice(2);
  if (paths.length === 0) {
    console.error(
      "usage: tsx src/config/validate.ts <config.yaml> [<manifest.yaml> ...]",
    );
    return 2;
  }

  const [configPath, ...manifestPaths] = paths;
  try {
    const config = await loadConfig(configPath);
    const effective = effectiveRunManifest(config);
    console.log(`ok: ${configPath}`);
    console.log(
      `  name=${config.name} variants=[${config.variants.join(", ")}] trials=${config.trials}`,
    );
    for (const scenario of config.scenarios) {
      console.log(`  scenario ${scenario.id} (${scenario.kind})`);
    }
    console.log(`  effective manifest sha256: ${effective.sha256}`);

    for (const manifestPath of manifestPaths) {
      const manifest = await loadVariantManifest(manifestPath);
      console.log(`ok: ${manifestPath}`);
      console.log(
        `  id=${manifest.id} read=${manifest.readMode} mutation=${manifest.mutationMode} capabilities=[${manifest.capabilities.join(", ")}]`,
      );
      if (!config.variants.includes(manifest.id)) {
        console.warn(
          `  warning: manifest id '${manifest.id}' is not listed in config variants`,
        );
      }
    }
    return 0;
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
