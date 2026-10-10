// Results-viewer CLI (plan §4.1). Rebuilds `results/index.html` from **all** runs:
//   pnpm report:all
//
// The same `writeViewer` is called at the end of every `rig:run` so the page is
// always current. A reporting failure must never mark a run failed, so the
// controller wraps its call in try/catch.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";
import { loadManifestDirectory } from "../config/load.js";
import { buildRunsIndex, renderViewerHtml } from "./viewer.js";

const rigRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Rebuild the viewer page; returns where it was written and how many runs it has. */
export async function writeViewer(
  resultsRoot: string = path.join(rigRoot, "results"),
): Promise<{ file: string; count: number }> {
  const manifests = await loadManifestDirectory(path.join(rigRoot, "manifests"));
  const runs = buildRunsIndex(resultsRoot, manifests);
  mkdirSync(resultsRoot, { recursive: true });
  const file = path.join(resultsRoot, "index.html");
  writeFileSync(file, renderViewerHtml(runs));
  return { file, count: runs.length };
}

async function main(): Promise<number> {
  const { file, count } = await writeViewer();
  console.log(`wrote results viewer: ${count} run(s)`);
  console.log(`  ${file}`);
  return 0;
}

// Run only when invoked directly (`tsx src/reporting/viewer-cli.ts`), never when
// imported by the controller.
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  exit(await main());
}
