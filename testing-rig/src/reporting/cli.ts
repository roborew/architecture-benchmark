// Reporting CLI (plan §6.6): turn a run's raw artefacts into the decision
// matrix. Usage:
//   pnpm report                      # the most recent run under results/
//   pnpm report 2026-10-09t12-21-15-875z
//
// Reads summary.json + inventory.json + manifests; writes report/{matrix.csv,
// matrix.md, index.html}. Never mutates the raw data.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";
import { loadManifestDirectory } from "../config/load.js";
import { RunArtifacts } from "../controller/artifacts.js";
import { buildMatrix, loadRun, toCsv, toHtml, toMarkdown } from "./matrix.js";

const rigRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function latestRun(resultsRoot: string): string | undefined {
  const dirs = readdirSync(resultsRoot)
    .map((name) => path.join(resultsRoot, name))
    .filter((p) => statSync(p).isDirectory())
    .sort();
  return dirs.at(-1);
}

async function main(): Promise<number> {
  const resultsRoot = path.join(rigRoot, "results");
  const arg = argv[2];
  const runDir = arg
    ? arg.includes(path.sep)
      ? arg
      : path.join(resultsRoot, arg)
    : latestRun(resultsRoot);

  if (!runDir) {
    console.error(`no runs found under ${resultsRoot}`);
    return 2;
  }

  const { summary, inventory, render, load, capacity } = loadRun(runDir);
  const manifests = await loadManifestDirectory(
    path.join(rigRoot, "manifests"),
  );
  const rows = buildMatrix(
    summary,
    inventory,
    manifests,
    render,
    load,
    capacity,
  );

  const meta = {
    runId: summary.runId,
    sha256: summary.effectiveManifestSha256,
  };
  const artifacts = new RunArtifacts(path.join(runDir, "report"));
  artifacts.write("matrix.csv", toCsv(rows));
  artifacts.write("matrix.md", toMarkdown(rows, meta));
  artifacts.write("index.html", toHtml(rows, meta));

  console.log(
    `wrote decision matrix for run ${summary.runId}: ${rows.length} variant(s)`,
  );
  console.log(`  ${path.join(runDir, "report", "matrix.csv")}`);
  console.log(`  ${path.join(runDir, "report", "matrix.md")}`);
  console.log(`  ${path.join(runDir, "report", "index.html")}`);
  return 0;
}

exit(await main());
