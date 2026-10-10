// Matrix runner: run every load × resource config file in one go.
//   pnpm rig:matrix
//   pnpm rig:matrix --loads small,medium --envelopes 2c2g,4c4g
//   pnpm rig:matrix --dry-run
//
// Each cell is a standalone config file `config/<load>-<env>.yaml` with its
// resource caps baked in, so this is a thin loop over `rig:run --config <file>`
// — no per-cell flags. Runs land in `results/` and the compare view groups them
// by `configName × envelope` (plan R4). Sequential: the rig is serial by design
// (one stack at a time on an idle host).

import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";
import { spawnSync } from "node:child_process";

const rigRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export interface Envelope {
  /** File-name tag, e.g. `2c2g`. */
  tag: string;
  cpus: number;
  memoryMb: number;
}

/** The load ladder, ascending — `config/<level>-<env>.yaml`. */
export const DEFAULT_LEVELS = ["small", "medium", "large"];

/** The resource envelopes: 1c/1g → 2c/2g → 4c/4g. */
export const DEFAULT_ENVELOPES: Envelope[] = [
  { tag: "1c1g", cpus: 1, memoryMb: 1024 },
  { tag: "2c2g", cpus: 2, memoryMb: 2048 },
  { tag: "4c4g", cpus: 4, memoryMb: 4096 },
];

export interface MatrixCell {
  level: string;
  envelope: Envelope;
  /** Absolute path to the standalone config file. */
  config: string;
  /** Human label, e.g. `medium @ 4c4g`. */
  label: string;
}

/** The Cartesian product of levels × envelopes, in run order. Pure. */
export function planMatrix(
  levels: string[],
  envelopes: Envelope[],
): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const level of levels) {
    for (const envelope of envelopes) {
      cells.push({
        level,
        envelope,
        config: path.join(rigRoot, "config", `${level}-${envelope.tag}.yaml`),
        label: `${level} @ ${envelope.tag}`,
      });
    }
  }
  return cells;
}

interface Options {
  levels: string[];
  envelopes: string[];
  passthrough: string[];
  dryRun: boolean;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    levels: [...DEFAULT_LEVELS],
    envelopes: DEFAULT_ENVELOPES.map((e) => e.tag),
    passthrough: [],
    dryRun: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--loads":
        options.levels = args[++i]!.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--envelopes":
        options.envelopes = args[++i]!.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      // Pass-through flags forwarded verbatim to every `rig:run`.
      case "--only":
        options.passthrough.push("--only", args[++i]!);
        break;
      case "--no-build":
      case "--no-cache":
      case "--skip-seeder-build":
      case "--with-correctness":
      case "--with-render":
      case "--with-load":
        options.passthrough.push(arg);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main(): Promise<number> {
  const options = parseArgs(argv.slice(2));
  const envelopes = DEFAULT_ENVELOPES.filter((e) =>
    options.envelopes.includes(e.tag),
  );
  if (envelopes.length === 0) {
    console.error(
      `no envelopes selected (known: ${DEFAULT_ENVELOPES.map((e) => e.tag).join(", ")})`,
    );
    return 2;
  }
  const cells = planMatrix(options.levels, envelopes);

  const missing = cells.filter((cell) => !existsSync(cell.config));
  if (missing.length > 0) {
    console.error("missing config files:");
    for (const cell of missing) console.error(`  - ${cell.config}`);
    return 2;
  }

  console.log(
    `matrix: ${options.levels.length} load level(s) × ${envelopes.length} envelope(s) = ${cells.length} run(s)`,
  );
  for (const cell of cells) console.log(`  ${cell.label}`);
  if (options.dryRun) return 0;

  const failures: MatrixCell[] = [];
  for (const cell of cells) {
    console.log(`\n===== ${cell.label} =====`);
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "src/controller/cli.ts",
        "--config",
        cell.config,
        ...options.passthrough,
      ],
      { cwd: rigRoot, stdio: "inherit" },
    );
    if (result.status !== 0) failures.push(cell);
  }

  console.log(
    `\nmatrix complete: ${cells.length - failures.length}/${cells.length} run(s) ok`,
  );
  for (const cell of failures) console.error(`  failed: ${cell.label}`);
  return failures.length === 0 ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  exit(await main());
}
