# Results viewer + load profiles — implementation plan

**Status:** implemented 10 Oct 2026 (D1–D4 + K1–K3, R1–R4, V-A, V-B; D5 deferred — optional) · **Last updated:** 10 October 2026
**Scope:** (V) a single HTML results viewer with a run selector, (V3) directory
file-count/size statistics surfaced in comparisons, (C) two new quick load-profile
configs (`medium-load`, `heavy-load`).

This plan is written to be executable by an agent with no other context. Every
file path, field name, and constraint below was audited against the repo as it
stands on 10 Oct 2026 (post-R7, `docs/agent-handoff.md`).

Two house rules apply throughout, inherited from `docs/live.md` and
`src/reporting/README.md`:

1. **No composite "best" column or score.** The viewer may highlight the
   per-metric leader, never declare an overall winner.
2. **Blank means not measured, never zero.** A cell with no artifact behind it
   renders as an em dash, not `0`.

---

## 1. Where the repo actually is (audited 10 Oct 2026)

### 1.1 What a run produces on disk today

Every `pnpm rig:run` writes `testing-rig/results/<run-id>/` (run-id =
UTC timestamp, e.g. `2026-10-09t17-44-06-935z`). 34 run directories exist
locally; `results/` is git-ignored (raw artefacts stay local by design).

| File                                       | Present                                | Contents (audited)                                                                                                                                                                                                              |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight.json`                           | always                                 | `runId`, `gitRevision`, `config` (source config path, e.g. `config/smoke-matrix.yaml`), `selected` (variant ids), `effectiveManifestSha256`                                                                                     |
| `effective-config.yaml`                    | always                                 | the fully-resolved experiment config — **the inputs of the run**                                                                                                                                                                |
| `run-manifest.json`                        | always                                 | per-variant `id`, `cohort`, compose `projectName`, `composeFile`, allocated `ports`                                                                                                                                             |
| `inventory.json`                           | always                                 | per-variant static inventory (§6.1): `source`/`tests`/`infrastructure` buckets, each `{files, loc, bytes, byLanguage}`; plus `directDependencies`, `languages`, `serviceCount`, `imageCount`                                    |
| `summary.json`                             | after preflight passes                 | `runId`, `effectiveManifestSha256`, per-variant `{id, cohort, status, performanceEligible, ports, stages{build,up,ready,reset,seed,verifySchema,verifyDigest,correctness?,render?,load?,mutations?,teardown}, error}`, `digest` |
| `variants/<id>/lifecycle.json`             | per attempted variant                  | full stage records incl. docker args/stdout — too verbose for the viewer; not embedded                                                                                                                                          |
| `variants/<id>/render.json`                | only with `--with-render`              | raw per-sample navigation (ttfb/fcp/lcp/firstData per page) + interaction timings — **raw arrays**, reduced to p50s by the viewer builder                                                                                       |
| `variants/<id>/load.json`                  | only with `--with-load`                | read-only k6 result: `vus`, `durationSeconds`, `requests`, `opsPerSecond`, `p95Ms`, `failedRate`, `generatorMaxCpuPercentObserved`, `generatorSaturated`, `pgStatements{before,after,delta}`                                    |
| `variants/<id>/k6-summary.json`            | only with `--with-load`                | full k6 end-of-test summary for the read stage (superset of `load.json`)                                                                                                                                                        |
| `variants/<id>/mutations-summary.json`     | with `--with-load` + a volume scenario | full k6 summary for the mutation replay: `metrics.http_req_duration{avg,med,p(90),p(95),p(99),max,min}`, per-op counters `mk_{create,update,delete}_ok{count,rate}`, `http_req_failed`, `checks`                                |
| `variants/<id>/mutations.json`             | same                                   | raw per-op k6 samples — **not embedded**                                                                                                                                                                                        |
| `variants/<id>/capture.json`               | with `--with-load` + volume            | captured real write requests (contains request **bodies**) — never embed in the viewer                                                                                                                                          |
| `variants/<id>/{capture,k6,mutations}.log` | with load stages                       | raw logs — not embedded                                                                                                                                                                                                         |
| `report/{matrix.csv,matrix.md,index.html}` | only after manual `pnpm report`        | the decision matrix, one static table per run                                                                                                                                                                                   |

Known irregularities the viewer must handle gracefully (they exist on disk
today): run dirs with a `summary.json` but an **empty** `variants/` (aborted
mid-run, e.g. the two `2026-10-10` runs), runs whose variants have no
`render.json`/`load.json` (run without the flags), and `next-trpc`-style runs
where GraphQL has no read-load target (`load.json` absent for that variant only).

### 1.2 What reporting does today

`pnpm report [<run-id>]` (`src/reporting/cli.ts`) reads one run's artefacts and
writes that run's `report/` trio. `matrix.ts` already contains the correct
reduction logic to reuse: `loadRun()`, `buildMatrix()`, `renderColumns()` (p50
via `percentile()`), the stage/`RenderReport`/`LoadReport` shapes, and the
escaping discipline in `toHtml()`.

### 1.3 The gaps this plan closes

- Results are invisible unless you `pnpm report` and then open a per-run
  `report/index.html` — one static table, no inputs (effective config) shown,
  no file-count/size statistics prominent, no way to move between runs.
- Load-side data beyond the single `load_ops_per_sec` column (read p95, request
  counts, generator saturation, mutation rates and latency percentiles) is
  written to disk but never rendered.
- There is no `medium`/`heavy` quick config between `smoke-matrix.yaml` and the
  long `default.yaml`.

---

## 2. Target — the single results viewer

One self-contained HTML page, `testing-rig/results/index.html`, regenerated
after every run, opened directly via `file://` with zero network access.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Architecture benchmark — results        Run: [ 2026-10-09t17-44 ▼ ] ‹ ›   │  ← select + prev/next
│ smoke-matrix · 14/14 ok · git dfdedd5 · sha fbc138ee…                     │  ← provenance line
├──────────────────────────────────────────────────────────────────────────┤
│ [All cohorts | next-fullstack | tanstack-start | spa-api]   (group tabs)  │
│                                                                            │
│ ▸ Inputs (effective config)   fixture counts, scenarios, browser,         │
│                               resources, reset, trials — collapsible      │
│ ▸ Lifecycle (6.2)             build/up/seed/verify ×ms per variant         │
│ ▸ Correctness (6.3)           pass/fail per variant                        │
│ ▸ Render (6.4)               ttfb/fcp/lcp/first-data p50, create/update/  │
│                               delete p50                                  │
│ ▸ Load (6.5)                 read ops/s, p95, requests, saturation flag;   │
│                               mutation ops/s per kind + latency percentiles│
│ ▸ Static & complexity (6.1)  files / LOC / **directory size** per bucket  │
│                               + totals + on-disk footprint, direct deps,  │
│                               languages, services, images                │
└──────────────────────────────────────────────────────────────────────────┘
```

Behaviour requirements:

- **Run selector** at the top lists every directory under `results/` that
  contains `summary.json` (or is recognisable as an attempted run), newest
  first. Label per option: `<config name> — <run-id> (<n>/<m> ok)`. The config
  name comes from `effective-config.yaml` (`name:`), the source path from
  `preflight.json`.
- Selecting a run swaps **everything run-dependent** (provenance, inputs, all
  tables). Static-per-variant identity columns (cohort/orm/read/mutation from
  `manifests/`) stay.
- **Deep link**: `results/index.html#<run-id>` opens that run directly; the
  hash updates on selection. Last selection persisted in `localStorage`.
- Aborted/incomplete runs are listed, marked "incomplete", and render whatever
  exists (e.g. inputs + the stage table with missing variants).
- Per-column leader highlight (best value bolded per visible column, direction
  annotated in the header tooltip: ms ↓, ops/s ↑, files/LOC/bytes ↓, deps ↓).
  **Never an aggregate score** (house rule 1).
- Generator-saturated load numbers render as "withheld — generator saturated"
  (they are invalid measurements, plan §6.5), not as their raw value.
- Failed variants get a red status cell with the `error` string expandable.

Non-requirements (explicitly out, see §8): no web server, no external CDN/JS
(the Tailwind-CDN reference doc `docs/workspace-crud-ui-tailwind-utilities-only.html`
is a design reference only — the viewer must work offline), no database, no
cross-run merging.

---

## 3. Work package V1 — the runs-index builder (`src/reporting/viewer.ts`)

New module `testing-rig/src/reporting/viewer.ts`. Two exports:

```ts
buildRunsIndex(resultsRoot: string): RunView[]     // reads disk, trims, normalises
renderViewerHtml(runs: RunView[]): string          // single self-contained page
```

### 3.1 Data shape

```ts
interface RunView {
  runId: string; // directory name
  incomplete: boolean; // no summary.json, or 0 variants recorded
  configName: string | null; // effective-config.yaml `name`
  configFile: string | null; // preflight.json `config`
  gitRevision: string | null; // preflight.json
  effectiveManifestSha256: string | null;
  startedAt: string | null; // parsed from the run-id timestamp
  okCount: number;
  totalCount: number;
  inputs: object | null; // the effective-config.yaml, parsed as-is
  variants: VariantView[];
}

interface VariantView {
  id: string;
  cohort: string;
  orm: string;
  readMode: string;
  mutationMode: string;
  status: string;
  performanceEligible: boolean;
  error: string | null;
  stages: Record<string, { ok: boolean; ms: number } | null>; // from summary.json
  inventory: {
    source: Bucket;
    tests: Bucket;
    infrastructure: Bucket;
    totals: { files: number; loc: number; bytes: number }; // NEW: sum of buckets
    footprint: { files: number; bytes: number } | null; // NEW: on-disk dir stats (V3)
    directDependencies: number;
    languages: number;
    serviceCount: number;
    imageCount: number;
  } | null;
  render: {
    // p50 reductions only — raw arrays are NOT embedded
    pages: Record<
      string,
      {
        ttfb: number | null;
        fcp: number | null;
        lcp: number | null;
        firstData: number | null;
      }
    >;
    interactions: Record<string, number | null>; // create/update/delete p50
  } | null;
  load: {
    // from load.json
    vus: number;
    requests: number;
    opsPerSecond: number | null;
    p95Ms: number | null;
    failedRate: number;
    generatorSaturated: boolean;
    pgStatementsDelta: number | null;
  } | null;
  mutations: {
    // reduced from mutations-summary.json metrics
    perOp: Record<
      "create" | "update" | "delete",
      { count: number; rate: number } | null
    >;
    duration: {
      avg: number;
      med: number;
      p90: number;
      p95: number;
      p99: number;
      max: number;
    } | null;
    failures: number | null;
  } | null;
  correctness: "pass" | "fail" | null; // stages.correctness from summary.json
}
```

### 3.2 Build rules

- Enumerate `results/*` directories. A directory is a run if it contains
  `preflight.json` **or** `summary.json` **or** `effective-config.yaml`.
  Anything else is ignored (future junk doesn't break the page).
- `summary.json` is the spine for variants. For each listed variant, read the
  optional per-variant artefacts (`render.json`, `load.json`,
  `mutations-summary.json`) with the same try/catch-absent pattern as
  `matrix.ts#loadRun`. Missing artefact → the section is `null` → renders as
  "—" with a "not measured in this run" tooltip.
- **Trim hard** (page-size budget ≈ 100 KB/run; 34 runs today ≈ 3–4 MB total,
  acceptable, but do not regress it):
  - `render.json`: reduce raw samples to p50s per page/interaction **in the
    builder** (reuse `percentile()` from `matrix.ts`); never embed sample arrays.
  - `mutations-summary.json`: embed only the `metrics` subset listed above —
    skip `root_group` and unlisted metrics.
  - Never embed `mutations.json` (raw samples), `capture.json` (contains
    request **bodies**), any `*.log`, or `lifecycle.json` (docker stdout).
- Manifest identity (cohort is already in `summary.json`; `orm`, `readMode`,
  `mutationMode`) comes from `loadManifestDirectory("manifests")` as in
  `cli.ts`. Missing manifest → "—".
- `inputs` is the parsed `effective-config.yaml` (use the existing `yaml`
  dependency). It is shown verbatim in the Inputs card — this is the
  "what were the inputs" requirement.
- Order variants: cohort, then id — stable across runs so eyeballing two runs
  is easy. Run list ordered newest-first by run-id.

### 3.3 Tests (`tests/viewer.test.ts`, no Docker)

- Synthesise a tmp `results/` tree in the test: (a) a complete run, (b) a run
  missing render/load artefacts, (c) an aborted run (summary with empty
  variants), (d) a junk directory. Assert: run discovery, `incomplete` flags,
  p50 reduction correctness against hand-computed values, saturation
  withholding, trim rules (no raw arrays / no capture body substring in the
  emitted JSON), and HTML escaping of `error` strings containing `<`/`&`.
- `renderViewerHtml`: assert every run id appears as an `<option>` and as a
  deep-link target; assert no external `src=`/`href=` references (offline rule).

---

## 4. Work package V2 — the page itself

### 4.1 Generation and wiring

- `package.json`: add `"report:all": "tsx src/reporting/viewer-cli.ts"` (or
  extend `src/reporting/cli.ts` with a `--all` mode — implementer's choice, but
  one command must rebuild `results/index.html` from **all** runs).
- **Auto-refresh**: at the end of a successful `rig:run` (in
  `src/controller/cli.ts`, immediately after `summary.json` is written), call
  the same builder so "every time we run a test, the page is current". Wrap in
  try/catch — a reporting failure must never mark a run failed. This is the
  user-facing guarantee: _run a test → open the same bookmarked page → new run
  is in the select box._
- Per-run `pnpm report` and its `report/index.html` stay as they are (each run
  keeps its own unique deep-linkable page; the consolidated page links to it).

### 4.2 Page construction

- Single HTML file: `<!doctype html>` + one `<style>` block + one
  `<script type="application/json" id="runs-data">` payload + one small
  `<script>` (vanilla, no framework, no CDN). Works from `file://` because all
  data is inline — `fetch()` of local JSON is blocked by browsers, which is
  exactly why the payload is embedded, not side-carred.
- Keep the visual language of the existing `toHtml()` matrix (system font
  stack, 12–13px tables, sticky headers, `gate-pass`/`gate-fail` colours) so
  the two artefacts look related.
- Every dynamic string inserted via the builder or the client script is
  HTML-escaped (error strings, config names, scenario ids).

### 4.3 Section specs (what renders, from where)

| Section     | Source                            | Notes                                                                                                                                                                                      |
| ----------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header      | `RunView` identity fields         | select (all runs), ‹ › prev/next, provenance chips: run-id, config name, source config path, git rev (short), ok-count, sha256 (short)                                                     |
| Inputs      | `RunView.inputs`                  | fixture counts, each scenario as a small table (kind, counts/weights+rates, concurrency, caps), browser block, resources, reset, trials, network. Collapsible `<details>`                  |
| Lifecycle   | `VariantView.stages`              | one row per variant, one column per stage, ×ms formatted (≥1000 → seconds, 1 decimal)                                                                                                      |
| Correctness | `VariantView.correctness`         | pass/fail badge; "—" when the run had no `--with-correctness`                                                                                                                              |
| Render      | `VariantView.render`              | p50 columns per page (`/projects`, `/projects/1`, `/tasks/1`) + interactions; blank-vs-zero rule for missing fcp/lcp (known SPA limitation, `src/render/README.md`)                        |
| Load        | `VariantView.load` + `.mutations` | read: ops/s, p95, requests, failed-rate, saturation flag; mutations: per-op rate, duration percentiles. Two sub-tables, labelled "read-only capacity" and "mutation volume"                |
| Static      | `VariantView.inventory`           | files / LOC / **bytes (human-readable KiB/MiB, exact value in `title`)** per bucket, the **totals row (files + directory size)**, footprint (V3), direct deps, languages, services, images |

- Sortable columns (click header; toggle asc/desc; remember per section).
- Cohort filter chips filter rows in every table at once.
- Formatting helpers: `fmtMs`, `fmtOps`, `fmtBytes` (1 decimal; `title` holds
  the exact number for copy-out).

---

## 5. Work package V3 — directory file-count / size statistics

The inventory already counts **authored** files/bytes (excluding `node_modules`,
build output, lockfiles — `src/reporting/inventory.ts`), and the viewer
surfaces them as totals (§3.1 `totals`, §4.3 Static). That answers "how many
files did we write and how big is what we wrote".

Add one optional field to `StaticInventory` for the whole-directory reality:

- `footprint: { files: number; bytes: number }` — a **stat-only** walk of the
  app directory with **no exclusions** (what `du` would see), computed in
  `collectInventory` with `statSync` only (no file reads, so it stays cheap).
- Backward compatible: absent in old `inventory.json` files → viewer renders
  "—". No schema change anywhere else; `inventory.json` is not zod-validated.
- The viewer shows both, labelled distinctly: "authored source" (existing
  buckets) vs "on-disk footprint (incl. deps/build)" — they answer different
  questions and conflating them was the original counting bug (see the comment
  header of `inventory.ts`).
- Test: for a tmp directory with a nested `node_modules`, authored counts
  exclude it, footprint includes it.

---

## 6. Work package C — load-profile configs

### 6.1 How the rig actually interprets a config today (be honest in the UI too)

Constraints the new YAMLs must satisfy (all enforced by `src/config/schema.ts`,
`.strict()` — unknown keys are rejected):

- `network.appToApiAddedRttMs` **must be 0** (phase-1 cohort has no separate
  backend; the validator rejects anything else).
- `fixture.statusPercent` must sum to exactly 100; `workingSetFraction` ∈ (0,1].
- `volume` scenario: `counts` all ≥ 0 with at least one > 0;
  `maxAttemptsPerOperation` is the retry ceiling — keep ~20–30% above the
  largest count (smoke uses 50→60, default 100→110).
- `capacity` scenario: `weights`, non-empty ascending `ratesPerSecond`,
  `durationPerStepSeconds`, `preallocatedVUs ≤ maxVUs`, `resetBefore`.
- Variant ids must match `manifests/` (no duplicates).

How load is actually driven today (`src/controller/cli.ts` + `lifecycle.ts`):

- The load stage runs only with `--with-load`. Read leg: **VUs = `appCpus × 2`,
  duration fixed 15 s**. Mutation leg: replays the **first `volume` scenario's
  `counts`** at concurrency `appCpus × 2` with a hard-wired 10-minute k6 cap,
  against eligibility pools derived from the fixture (read 1..⌊N/2⌋, update the
  next 30 %, delete the final 20 % — delete counts must therefore stay within
  20 % of `taskCount`, which every profile below does with wide margin).
- The **`capacity` scenario is declared but not yet executed as a rate ladder**
  (it is the R8 "capacity ladders" next step). It is included in both new
  configs so the shape is ready and the viewer's Inputs card shows the intended
  ladder, but no numbers come from it yet. This must be stated in the plan's
  handoff and visible in the viewer (label: "not yet executed").
- `trials` is validated but the controller currently makes **one pass** per
  variant. Declaring `trials: 3` is forward-compatible; wall-clock today is
  one pass.
- A generator-saturated trial (k6 CPU > `generatorMaxCpuPercent`) is withheld,
  not shown as an app number.

Practical lever map for "push each architecture maximally" **within today's
implementation**: volume `counts` (total mutation work), `appCpus` (which
doubles as load VUs **and** the app's container CPU cap — the fairness knob),
`dbCpus`/memory caps, and fixture size (rows per list/detail page, working-set
size via `workingSetFraction`).

### 6.2 `config/medium-load.yaml` — quick mid-load matrix

All 14 variants, one pass, mid-size fixture, mid volume. Target: tens of
minutes, not hours. Full file content:

```yaml
# Medium load — quick mid-intensity matrix (between smoke-matrix and default).
schemaVersion: 1
name: medium-load
variants:
  - next-actions
  - next-drizzle
  - next-prisma
  - next-trpc
  - next-orpc
  - tanstack-start-react
  - tanstack-start-solid
  - tanstack-express-rest
  - tanstack-fastify-rest
  - tanstack-flask-rest
  - tanstack-fastapi-rest
  - tanstack-elixir-rest
  - tanstack-express-graphql
  - tanstack-express-orpc
trials: 2
variantOrder: rotate

fixture:
  seedVersion: 1
  seed: 42
  projectCount: 20
  userCount: 100
  taskCount: 10000
  commentCount: 20000
  baseTimestamp: "2025-01-01T00:00:00Z"
  statusPercent: { todo: 50, "in progress": 30, done: 20 }
  workingSetFraction: 0.20

reset:
  betweenPhases: true
  betweenTrials: true
  method: database-recreate

browser:
  engine: chromium
  workers: 1
  warmupSamples: 5
  measuredSamples: 15
  viewport: { width: 1365, height: 768 }
  cacheProfile: cold-browser-context
  prefetch: disabled
  operations: [list, detail, create, update, delete]

scenarios:
  - id: volume-medium-writes
    kind: volume
    counts: { list: 400, detail: 200, create: 100, update: 100, delete: 100 }
    concurrency: 10
    maxAttemptsPerOperation: 130
    maxDurationSeconds: 900
    resetBefore: true
  - id: capacity-medium-mixed
    kind: capacity
    weights: { list: 40, detail: 20, create: 15, update: 15, delete: 10 }
    ratesPerSecond: [10, 20, 40]
    durationPerStepSeconds: 60
    preallocatedVUs: 50
    maxVUs: 200
    resetBefore: true

network:
  browserToAppAddedRttMs: 0
  appToApiAddedRttMs: 0

resources:
  appCpus: 2
  appMemoryMb: 2048
  dbCpus: 2
  dbMemoryMb: 2048

load:
  generatorMaxCpuPercent: 75

report:
  keepRawSamples: true
  outputFormats: [json, csv, html]
```

### 6.3 `config/heavy-load.yaml` — the maximal-push profile

Double the default's data volume and 5× its mutation volume, doubled CPU
budgets (which also doubles load VUs to 8). Full file content:

```yaml
# Heavy load — maximal push within the current load implementation.
# NOTES BEFORE RUNNING (see plan §6.1):
#  - the mutation leg uses volume-heavy-writes counts at concurrency appCpus*2
#    (8), hard-capped at 10 minutes by the rig;
#  - the capacity ladder below is declared for shape-compatibility and the
#    future rate-stepper (R8) — it is not executed today;
#  - trials is forward-compatible (one pass today);
#  - seed/reset at this fixture size takes minutes per variant — rehearse with
#    --only next-actions first, and check Docker Desktop's memory budget
#    (this stack caps app 4096 + db 4096 + seeder/k6; VM headroom ≥ 10 GB).
schemaVersion: 1
name: heavy-load-max
variants:
  - next-actions
  - next-drizzle
  - next-prisma
  - next-trpc
  - next-orpc
  - tanstack-start-react
  - tanstack-start-solid
  - tanstack-express-rest
  - tanstack-fastify-rest
  - tanstack-flask-rest
  - tanstack-fastapi-rest
  - tanstack-elixir-rest
  - tanstack-express-graphql
  - tanstack-express-orpc
trials: 3
variantOrder: rotate

fixture:
  seedVersion: 1
  seed: 42
  projectCount: 100
  userCount: 500
  taskCount: 100000
  commentCount: 200000
  baseTimestamp: "2025-01-01T00:00:00Z"
  statusPercent: { todo: 50, "in progress": 30, done: 20 }
  workingSetFraction: 0.20

reset:
  betweenPhases: true
  betweenTrials: true
  method: database-recreate

browser:
  engine: chromium
  workers: 1
  warmupSamples: 10
  measuredSamples: 30
  viewport: { width: 1365, height: 768 }
  cacheProfile: cold-browser-context
  prefetch: disabled
  operations: [list, detail, create, update, delete]

scenarios:
  - id: volume-heavy-writes
    kind: volume
    counts: { list: 2000, detail: 1000, create: 500, update: 500, delete: 500 }
    concurrency: 25
    maxAttemptsPerOperation: 650
    maxDurationSeconds: 1800
    resetBefore: true
  - id: capacity-heavy-mixed
    kind: capacity
    weights: { list: 40, detail: 20, create: 15, update: 15, delete: 10 }
    ratesPerSecond: [20, 50, 100, 200]
    durationPerStepSeconds: 120
    preallocatedVUs: 100
    maxVUs: 400
    resetBefore: true

network:
  browserToAppAddedRttMs: 0
  appToApiAddedRttMs: 0

resources:
  appCpus: 4
  appMemoryMb: 4096
  dbCpus: 4
  dbMemoryMb: 4096

load:
  generatorMaxCpuPercent: 75

report:
  keepRawSamples: true
  outputFormats: [json, csv, html]
```

Rationale per knob (heavy): 4 CPUs per app/db container is the biggest fair
budget that still fits a laptop Docker VM alongside a 4-VU… 8-VU k6 generator;
`appCpus: 4` raises load VUs to 8; delete count 500 sits far inside the 20 %
delete pool (100 000 × 0.2 = 20 000 ids); `maxAttemptsPerOperation: 650` gives
30 % retry headroom over 500; fixture 2× default exercises list/detail over
bigger tables and indexes while keeping seed time minutes-not-hours. If seed
time proves acceptable, the escalation path is `taskCount: 200000` /
`commentCount: 400000` (see §9).

### 6.4 Validation and rehearsal gates for C

1. `pnpm config:validate config/medium-load.yaml manifests` — green.
2. `pnpm config:validate config/heavy-load.yaml manifests` — green.
3. Extend the shipped-configs test (`tests/config.test.ts` — it loads
   `default.yaml` and `smoke-matrix.yaml` by name) to also load and validate
   `medium-load.yaml` and `heavy-load.yaml`.
4. Rehearse single-variant before any full matrix:
   `pnpm rig:run --config config/medium-load.yaml --only next-actions --with-correctness --with-render --with-load`
   then the same with `--config config/heavy-load.yaml`. Check: mutation leg
   finishes inside the 10-minute k6 cap; no generator saturation; seed time
   acceptable; the viewer shows the new runs.
5. Only then the full 14-variant matrices (medium first, heavy after).

---

## 7. Implementation order and gates

Ordered, each step independently verifiable. V1→V3 (viewer) and C (configs)
are independent and can proceed in parallel; V2's auto-refresh depends on V1.

| Step | Work                                      | Gate (must actually pass)                                                                                                                                                                                                                     |
| ---- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | C: add both config YAMLs                  | `pnpm config:validate` both green; `pnpm test`; `pnpm typecheck`                                                                                                                                                                              |
| 2    | V1: `viewer.ts` builder + tests           | `pnpm test` (new `tests/viewer.test.ts` green incl. trim/escape/saturation cases); `pnpm typecheck`                                                                                                                                           |
| 3    | V2: `renderViewerHtml` + `report:all` CLI | `pnpm report:all` → open `results/index.html` via `file://`: all 34 runs listed; select a fully-loaded smoke run (e.g. `2026-10-09t17-44-06-935z`) → every section renders; incomplete runs flagged; deep link `#<run-id>` works after reload |
| 4    | V2: auto-refresh in controller            | Re-run any tiny run (`--only next-actions` smoke) → the page contains the new run without invoking `report:all`; run status unaffected by a deliberately broken report (try/catch proof)                                                      |
| 5    | V3: inventory `footprint` + viewer totals | `pnpm test` (footprint test); re-run `pnpm report:all` → old runs show "—" footprint, a fresh inventory shows both authored totals and footprint                                                                                              |
| 6    | Rehearse C                                | §6.4 rehearsal runs on `next-actions` for both profiles; no saturation; timings recorded in `docs/agent-handoff.md`                                                                                                                           |
| 7    | Full matrices (user-scheduled)            | `pnpm rig:run --config config/medium-load.yaml --with-correctness --with-render --with-load` → 14/14 ok → viewer; then heavy                                                                                                                  |
| 8    | Docs                                      | Update `testing-rig/README.md` (new commands + viewer), `src/reporting/README.md`, `docs/agent-handoff.md` (new milestone entry), this file's status line                                                                                     |

Files touched (complete list):

- **New:** `testing-rig/src/reporting/viewer.ts`, `testing-rig/src/reporting/viewer-cli.ts` (or extend `cli.ts`), `testing-rig/tests/viewer.test.ts`, `testing-rig/config/medium-load.yaml`, `testing-rig/config/heavy-load.yaml`, `testing-rig/results/index.html` (generated artefact, git-ignored).
- **Modified:** `testing-rig/package.json` (script), `testing-rig/src/controller/cli.ts` (auto-refresh call), `testing-rig/src/reporting/inventory.ts` (footprint), `tests/config.test.ts` (new configs), the three README/doc files above.
- **No app changes.** No changes under `apps/`, no new runtime dependencies (the viewer is server-generated static HTML; `yaml` + `zod` already present).

---

## 8. Non-goals (do not build these here)

- A web server or anything that requires one; external CDN/JS in the viewer.
- Cross-run aggregation or a composite "best" score (house rule; per-metric
  leaders only).
- Executing capacity rate-ladders (R8 future work — configs declare, rig
  doesn't run them yet; say so in the UI).
- Write-load adapters per transport, trial-looping, or merging runs into a
  database. The viewer is a **view** over `results/`, never a second copy of
  the data (same principle as `pnpm report`).

## 9. Open decisions (confirm before/at step 1)

1. **Heavy fixture ceiling** — 100 k tasks / 200 k comments (recommended: seed
   stays minutes) vs 200 k / 400 k (true maximal, seed likely 10+ min per
   variant). Decide after the §6.4 rehearsal seed-timing measurement.
2. **Auto-refresh vs manual** — recommended auto (step 4); manual-only is the
   fallback if the controller coupling proves annoying.
3. **Compare-two-runs mode** (pin a baseline run, show Δ columns) — valuable
   but not in this pass; deep links + the selector cover the stated need.
   Schedule as a follow-up.
4. **Failed-run log tails** — embedding the last ~50 lines of `mutations.log` /
   `k6.log` for failed variants only (small, useful for debugging from the
   page). Recommended yes; confirm size tolerance.
