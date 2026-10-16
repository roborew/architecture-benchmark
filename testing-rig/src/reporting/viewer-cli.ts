// Results-viewer CLI (plan §4.1). Rebuilds the viewer pair from **all** runs:
//   pnpm report:all
//
// `results/index.html` is a data-free shell; `results/runs-data.json` is the
// trimmed index it fetches on the fly. `results/runs-data.js` is the same
// payload as a JS assignment — the shell falls back to it when `fetch` is
// blocked (opening the page from `file://`). The same `writeViewer` is called
// at the end of every `rig:run` so the set is always current. A reporting
// failure must never mark a run failed, so the controller wraps its call in
// try/catch.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";
import { loadManifestDirectory } from "../config/load.js";
import {
  buildRunsIndex,
  renderViewerData,
  renderViewerDataJs,
  renderViewerHtml,
} from "./viewer.js";

const rigRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the viewer data is written: the trimmed index the shell fetches. */
export const VIEWER_DATA_FILE = "runs-data.json";

/** The script-tag twin of {@link VIEWER_DATA_FILE}, the `file://` fallback. */
export const VIEWER_DATA_SCRIPT_FILE = "runs-data.js";

/** Rebuild the viewer files; returns where they were written and the run count. */
export async function writeViewer(resultsRoot: string = path.join(rigRoot, "results")): Promise<{
  file: string;
  dataFile: string;
  scriptFile: string;
  count: number;
}> {
  const manifests = await loadManifestDirectory(path.join(rigRoot, "manifests"));
  const runs = buildRunsIndex(resultsRoot, manifests);
  mkdirSync(resultsRoot, { recursive: true });
  const file = path.join(resultsRoot, "index.html");
  const dataFile = path.join(resultsRoot, VIEWER_DATA_FILE);
  const scriptFile = path.join(resultsRoot, VIEWER_DATA_SCRIPT_FILE);
  writeFileSync(file, renderViewerHtml());
  writeFileSync(dataFile, renderViewerData(runs));
  writeFileSync(scriptFile, renderViewerDataJs(runs));
  return { file, dataFile, scriptFile, count: runs.length };
}

async function main(): Promise<number> {
  const { file, dataFile, scriptFile, count } = await writeViewer();
  console.log(`wrote results viewer: ${count} run(s)`);
  console.log(`  ${file} (+ ${dataFile} + ${scriptFile})`);
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
