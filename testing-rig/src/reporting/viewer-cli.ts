// Results-viewer CLI (plan §4.1). Rebuilds the viewer pair from **all** runs:
//   pnpm report:all
//
// `results/index.html` is a data-free shell; `results/runs-data.json` is the
// trimmed index it fetches on the fly. The same `writeViewer` is called at the
// end of every `rig:run` so the pair is always current. A reporting failure
// must never mark a run failed, so the controller wraps its call in try/catch.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";
import { loadManifestDirectory } from "../config/load.js";
import {
  buildRunsIndex,
  renderViewerData,
  renderViewerHtml,
} from "./viewer.js";

const rigRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Where the viewer pair is written: the shell page and its on-the-fly data. */
export const VIEWER_DATA_FILE = "runs-data.json";

/** Rebuild the viewer pair; returns where they were written and the run count. */
export async function writeViewer(
  resultsRoot: string = path.join(rigRoot, "results"),
): Promise<{ file: string; dataFile: string; count: number }> {
  const manifests = await loadManifestDirectory(
    path.join(rigRoot, "manifests"),
  );
  const runs = buildRunsIndex(resultsRoot, manifests);
  mkdirSync(resultsRoot, { recursive: true });
  const file = path.join(resultsRoot, "index.html");
  const dataFile = path.join(resultsRoot, VIEWER_DATA_FILE);
  writeFileSync(file, renderViewerHtml());
  writeFileSync(dataFile, renderViewerData(runs));
  return { file, dataFile, count: runs.length };
}

async function main(): Promise<number> {
  const { file, dataFile, count } = await writeViewer();
  console.log(`wrote results viewer: ${count} run(s)`);
  console.log(`  ${file} (+ ${dataFile})`);
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
