# Reporting (plan §6.1/§6.6)

Turns a run's raw artefacts into the **decision matrix** — the rig's primary
output. A report is a reproducible view over the raw data, never the only copy.

## Modules

| File            | Responsibility                                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory.ts`  | Static & complexity inventory (plan §6.1): source vs tests vs infrastructure, by language; direct dependency count; service/image counts; whole-directory `footprint`. Excludes deps, build output, lockfiles, generated code, fixtures and reports for the authored buckets. |
| `matrix.ts`     | `buildMatrix` + `toCsv` / `toMarkdown` / `toHtml`, and `percentile`. Reads `summary.json`, `inventory.json`, each `variants/<id>/render.json` and the manifests.                                                                                                              |
| `cli.ts`        | `pnpm report [<run-id>]` → `results/<run-id>/report/{matrix.csv,matrix.md,index.html}`.                                                                                                                                                                                       |
| `viewer.ts`     | `buildRunsIndex(resultsRoot, manifests)` → `RunView[]`; `renderViewerHtml(runs)` → one self-contained page. Reduces raw render samples to p50s and embeds only trimmed data (plan §3).                                                                                        |
| `viewer-cli.ts` | `pnpm report:all` → `results/index.html` (every run). Also called by the controller after each run.                                                                                                                                                                           |

## Matrix shape

One row per variant; columns grouped by plan section:

- **identity** — variant, cohort, orm, read mode, mutation mode.
- **6.3 correctness** — the gate result (`pass`/`fail`).
- **6.2 build & deploy** — build/up/seed/verify wall-clock ×ms.
- **6.1 static** — source/test/infra files, LOC and bytes; direct deps;
  languages; services; images.
- **6.4 render**, **6.5 load** — render columns populate with `--with-render`
  (R6); `load_ops_per_sec` populates with `--with-load` (R7, read-only). A
  generator-saturated load run is withheld, not shown. Blank means _not yet
  measured_, never zero.
- **provenance** — the effective-config sha256 (every value carries it).

There is deliberately **no composite "best" column** (`live.md`: the decision
matrix comes first). A weighted view, if configured, is rendered _alongside_ the
raw columns, never instead of them.

## Not yet implemented

Write-load adapters per transport (plan §5/§7) — the load column is read-only
capacity. The column set is fixed so the matrix shape does not churn as they land.

## Results viewer (`pnpm report:all`)

`results/index.html` — one self-contained page (no server, no CDN; opens from
`file://`) with a run selector over every directory under `results/`. Selecting a
run swaps the provenance line, the Inputs card (the parsed `effective-config.yaml`)
and every table: Lifecycle stages ×ms, Correctness, Render p50s, Load (read-only
capacity + mutation volume), and Static & complexity (authored source/test/infra
totals vs the whole-directory `footprint`).

House rules hold: a per-column leader is bolded, but there is **no composite
score**; a blank cell means _not measured_, never zero; a generator-saturated load
trial renders as "withheld", not its raw value. Deep links (`#<run-id>`) and
`localStorage` remember the last selection. The controller refreshes the page at
the end of every `rig:run` (best-effort; a reporting failure never fails a run).
The page embeds a trimmed index only (p50s, no raw sample arrays, never
`capture.json` request bodies, `mutations.json` samples, `lifecycle.json` or logs).
