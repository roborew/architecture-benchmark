# Reporting (plan §6.1/§6.6)

Turns a run's raw artefacts into the **decision matrix** — the rig's primary
output. A report is a reproducible view over the raw data, never the only copy.

## Modules

| File            | Responsibility                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inventory.ts`  | Static & complexity inventory (plan §6.1): source vs tests vs infrastructure, by language; direct dependency count discovered across **all** nested manifests (D3, `dependencyManifests` breakdown); service/image counts; whole-directory `footprint`. Excludes deps, build output, lockfiles, generated code, fixtures and reports for the authored buckets.                       |
| `matrix.ts`     | `buildMatrix` + `toCsv` / `toMarkdown` / `toHtml`, and `percentile`. Reads `summary.json`, `inventory.json`, each `variants/<id>/render.json` and the manifests.                                                                                                                                                                                                                     |
| `cli.ts`        | `pnpm report [<run-id>]` → `results/<run-id>/report/{matrix.csv,matrix.md,index.html}`.                                                                                                                                                                                                                                                                                              |
| `viewer.ts`     | `buildRunsIndex(resultsRoot, manifests)` → `RunView[]`; `renderViewerHtml()` → a data-free shell; `renderViewerData(runs)` → the trimmed `runs-data.json` the shell fetches on the fly; `renderViewerDataJs(runs)` → the same payload as `runs-data.js`, the script-tag fallback for `file://`. Reduces raw render samples to p50s; only trimmed views leave the run tree (plan §3). |
| `viewer-cli.ts` | `pnpm report:all` → `results/index.html` + `results/runs-data.json` + `results/runs-data.js` (every run). Also called by the controller after each run.                                                                                                                                                                                                                              |

## Matrix shape

One row per variant; columns grouped by plan section:

- **identity** — variant, cohort, orm, read mode, mutation mode.
- **6.3 correctness** — the gate result (`pass`/`fail`).
- **6.2 build & deploy** — build/up/seed/verify wall-clock ×ms.
- **6.1 static** — source/test/infra files, LOC and bytes; direct deps;
  languages; services; images.
- **6.4 render**, **6.5 load** — render columns populate with `--with-render`
  (R6); `load_ops_per_sec` populates with `--with-load` (R7, read-only). A
  generator-saturated load run is withheld, not shown. `app_max_cpu_pct_env` /
  `app_max_mem_pct_env` are the peak CPU/RAM of the loaded service across the
  run's load legs, as percent **of its `resources:` envelope** (not of host).
  Blank means _not yet measured_, never zero.
- **provenance** — the effective-config sha256 (every value carries it).

There is deliberately **no composite "best" column** (`live.md`: the decision
matrix comes first). A weighted view, if configured, is rendered _alongside_ the
raw columns, never instead of them.

## Not yet implemented

Write-load adapters per transport (plan §5/§7) — the load column is read-only
capacity. The column set is fixed so the matrix shape does not churn as they land.

## Results viewer (`pnpm report:all`)

`results/index.html` is a **data-free shell**: it carries only the chrome, styles and
rendering code, and fetches `results/runs-data.json` (the trimmed index) on the
fly. Served over HTTP it always reads fresh data; opened from `file://` (where
fetch is blocked) it falls back to loading the sibling `runs-data.js` — the same
payload as a script-tag — so the generated page works straight from disk too.
Two modes:

- **Run view** — a run selector over every directory under `results/`. Selecting a
  run swaps the provenance line, the Inputs card (the parsed `effective-config.yaml`,
  including the effective `stages` selection) and every table: Lifecycle, Correctness,
  Render p50s, Load (read-only capacity + mutation volume + a **capacity ladder** with
  an achieved-vs-target line chart), and Static & complexity (authored totals vs the
  whole-directory `footprint`). Inline-SVG bar charts sit above each table; a per-path
  read-latency table (K1) and per-threshold ✓/✗ badges (K2) are included, as are
  container CPU/RAM columns, per-variant CPU%/RAM%-over-time charts and **overlaid**
  resource charts — one line per variant on shared time axes per leg — for
  variant-against-variant comparison (downsampled from `resources/*-samples.json`;
  percent of the service's envelope, not of host).
- **Compare view** — runs grouped into load levels (`configName × resource envelope`,
  R4): an inputs side-by-side table (differing cells highlighted), a metric grid
  (variant rows × level columns, per-metric leader), a scaling line chart (one line per
  variant, cohort-coloured, toggleable) and per-metric **tip-over facts** (never a
  composite score). Tip-over facts name the **binding resource** where a leg tipped
  ("tipped at 40/s — CPU 99% of env, RAM 41% → CPU-bound" / "OOM ×2 → RAM-bound"). An
  honesty strip warns on differing revision/inputs/variant set/stages.

Deep links: `#<run-id>` (run view) and `#compare=<id>,<id>&metric=ops` (compare view);
`localStorage` remembers the last run. When a section's stage was not requested by the
run's config, the section shows a **banner with the exact re-run command** (plan D2)
instead of a bare empty table; a requested-but-failed stage keeps its error. House rules
hold: a per-column leader is bolded, but there is **no composite score**; a blank cell
means _not measured_, never zero; a generator-saturated load trial renders as "withheld".
The controller refreshes the set at the end of every `rig:run` (best-effort; a
reporting failure never fails a run). `runs-data.json` carries a trimmed index
only (p50s, no raw sample arrays, never `capture.json` request bodies,
`mutations.json` samples, `lifecycle.json` or logs); `runs-data.js` is the same
payload wrapped as `window.__RUNS_DATA__ = …`; the shell itself embeds no
run data at all.
