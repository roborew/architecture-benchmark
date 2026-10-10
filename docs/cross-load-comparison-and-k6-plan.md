# Cross-load comparison dashboard + k6 utilization — implementation plan

**Status:** ready to hand off · **Last updated:** 10 October 2026
**Scope:** (K) close the k6 feature gaps that make "tip-over" measurable,
(V-A) graphs in the per-run view, (V-B) a compare dashboard that consolidates
runs across load levels (small → medium → heavy) and shows which architecture
degrades where.

**Depends on** `docs/measurement-stages-and-deps-inventory-fix-plan.md`
(D1–D4: config-driven `stages:`, effective-stage recording, dep-count fix) —
this plan builds on the effective-stage and banner mechanics it introduces.
Standalone otherwise. House rules unchanged: blank means not measured, never
zero; no composite "best" score; the viewer is a view, never a second copy of
the data; no external network assets in the viewer.

---

## 1. Where we are (audited 10 Oct 2026)

### 1.1 k6 usage today (`load/read.js`, `load/mutations.js`, `lifecycle.ts`)

Used already (correctly):

- `scenarios`/executors: `constant-vus` (read leg, VUs = `appCpus × 2`, fixed
  duration) and per-op shared-iterations scenarios (mutation replay, exact
  per-op counts, leased pool ids).
- `summaryTrendStats` incl. `p(90)`/`p(95)`; `discardResponseBodies`.
- Custom `Counter`s (`mk_create_ok` …) for offered-vs-achieved; `check`s;
  per-op `tags`; `k6/execution` scenario introspection.
- Generator-CPU sampling against `generatorMaxCpuPercent` (saturated runs
  withheld, plan §6.5).

Not used — and why it matters (grounded in the k6 docs,
`grafana.com/docs/k6/latest`):

| Missing k6 feature                                               | What it would give us                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arrival-rate executors** (`constant-arrival-rate`, open model) | Today's load is **closed-loop**: VUs pace themselves, so we measure the throughput _ceiling_ but can never ask "what happens at a fixed 50 req/s" — latency under a _held_ rate is exactly the tip-over signal. `constant-arrival-rate` holds the rate (`rate`/`timeUnit`), scales VUs up to `maxVUs`, and exposes `dropped_iterations` when the target can't be sustained. |
| **Thresholds** (`abortOnFail: false`)                            | ✓/✗ health labels per run (`http_req_failed: rate<0.01`, `http_req_duration: p(95)<800`) that land in the summary and the viewer, _without_ gating (the rig measures, it does not gate — `read.js` header says so explicitly; keep that principle, labels not gates).                                                                                                       |
| **Per-path tags** (read leg)                                     | `http_req_duration{path:/projects}` sub-metrics — per-path latency breakdown in the viewer instead of one blended number.                                                                                                                                                                                                                                                   |
| **`handleSummary`**                                              | The scripts' summary today is the legacy export shape; `handleSummary` gives full control (incl. threshold results) of the exported JSON.                                                                                                                                                                                                                                   |

Explicitly **not** adopting (documented non-goals, §7): k6/Grafana Cloud
(network + account), the k6 browser module (Playwright already owns render),
CSV output (JSON is already consumed).

### 1.2 The structural gap: `capacity` scenarios are declared but never executed

`medium-load.yaml` and `heavy-load.yaml` already declare capacity ladders
(`ratesPerSecond: [10,20,40]` / `[20,50,100,200]`, `durationPerStepSeconds`,
`preallocatedVUs`, `maxVUs`, `weights`) — the schema validates them, the
controller ignores them (known R8 remainder, `docs/agent-handoff.md`). The
schema fields map **1:1** onto `constant-arrival-rate` options
(`rate` ← each step, `duration` ← `durationPerStepSeconds`,
`preAllocatedVUs` ← `preallocatedVUs`, `maxVUs` ← `maxVUs`), so K3 below is
execution of an already-designed shape, not a new config language.

### 1.3 The viewer today (`src/reporting/viewer.ts`, ~1100 lines)

- Single-run selection; every run's **reduced** data (inputs, stages,
  inventory, render p50s, load, mutations) already embedded in the page
  payload — a compare dashboard is a **client-side re-slice of data already
  in the page**, no new artifacts, no server.
- No charts anywhere; tables only.
- Runs carry `configName` + full `inputs` (fixture counts, scenario
  declarations, resources) — enough to group runs into load levels and to
  show _why_ two runs differ (inputs side by side).

### 1.4 Resource limits today (audited — the mechanism already exists)

The per-service Docker CPU/RAM limits the hardware-limitation goal needs are
**already wired end-to-end**:

- Every app `compose.yaml` (all 15) sets `deploy.resources.limits.cpus/memory`
  per service, templated on env vars — `db`: `${DB_CPUS}/${DB_MEMORY_MB}`;
  `app` (or `api` + `spa` in `spa-api` stacks, both on the APP_* vars):
  `${APP_CPUS}/${APP_MEMORY_MB}`. Docker enforces these as cgroup CFS quota /
  memory limit — on macOS inside the Docker Desktop VM, natively on Linux.
- The controller injects them from the config's `resources:` block
  (`resourcesOf` → `composeEnv`, `src/controller/plan.ts` —
  `APP_CPUS/APP_MEMORY_MB/DB_CPUS/DB_MEMORY_MB`).
- The seeder service and the k6 generator container run **uncapped** (correct:
  they are not the system under test; generator fairness is guarded by the
  CPU-saturation monitor).

What's missing is **orthogonality**: resources are baked into each load
config (`medium-load` 2c/2g, `heavy-load` 4c/4g), so "medium load on minimum
resources vs medium load on ample resources" requires duplicating whole YAMLs,
and an out-of-band override would silently break provenance (the run hash is
computed from the config before any override could be recorded — see R1).
Work package R (§3bis) closes exactly this.

### 1.5 Load levels available once the fix plan lands

`smoke-matrix.yaml` (small), `medium-load.yaml`, `heavy-load.yaml` — three
profiles, each one command (`pnpm rig:run --config <cfg>`), each fully
self-driving (correctness + render + load) after D4. Same `seed`,
`seedVersion`, and schema across all three, so cross-level comparison is
apples-to-apples on data; the deltas are fixture volume, op counts,
concurrency, and resources — which the compare view must display, never hide.

---

## 2. Target — what the page gains

```text
┌────────────────────────────────────────────────────────────────────┐
│ Architecture benchmark — results     [ Run view | Compare view ]     │
│                                                                      │
│ RUN VIEW (today's, plus)                                             │
│   ▸ per-metric inline SVG bars (render p50s by cohort, read ops/s,  │
│     mutation rates, p95 by path)      — charts are views; tables     │
│     stay the source of truth                                         │
│                                                                      │
│ COMPARE VIEW (new)                                                   │
│   Runs: [✓ smoke-matrix …] [✓ medium-load …] [✓ heavy-load …]        │
│   ▸ Inputs side-by-side (fixture, counts, concurrency, resources,   │
│     stages) with differences highlighted                             │
│   ▸ Metric grid: variant rows × load-level columns, per metric       │
│     (read ops/s · p95 · dropped-iters · mutation rate · render       │
│     first-data · correctness) — leader per row highlighted           │
│   ▸ Scaling charts: metric vs load level, one line per variant       │
│     (cohort filter; variant picker)                                  │
│   ▸ Tip-over badges per variant: "errors at heavy", "p95 ×4 heavy",  │
│     "throughput flat medium→heavy", "withheld (generator)" —         │
│     each badge is a per-metric fact, never a composite score         │
└────────────────────────────────────────────────────────────────────┘
```

Design rules (all carried over, not negotiable):

- **Offline, self-contained, vanilla only.** Charts are hand-rolled inline
  SVG (bars + simple lines, ~150 lines of JS). No Chart.js, no CDN, no
  `fetch`. The page keeps working from `file://` with no network.
- **Inputs are first-class in compare.** Every metric delta is shown next to
  the input deltas (fixture ×20, counts ×5, CPUs ×2…) — a comparison that
  hides inputs is a wrong comparison.
- **Honesty warnings, not blockers:** compared runs with different
  `gitRevision` / `effectiveManifestSha256`, different variant sets, or
  missing stages in some runs get a warning strip (the D2 banner logic
  reused); the grid still renders.
- **Blank means not measured; withheld means generator-saturated.** In the
  grid too.

---

## 3. Work package K — k6 utilization

### K1 — per-path tags in the read leg (small)

`load/read.js`: tag each request `tags: { path }` → `http_req_duration{path:…}`
sub-metrics per path; the controller's `load.json` gains a per-path p50/p95
map; the viewer read table gains a per-path breakdown row group. `read.js`
also moves from "no thresholds" to the labelled thresholds of K2 (below) —
update its header comment accordingly.

### K2 — thresholds as recorded health labels, not gates (small)

Both scripts gain, via `options.thresholds` with **`abortOnFail` left false**
(default short format):

```js
thresholds: {
  http_req_failed: ["rate<0.01"],
  http_req_duration: ["p(95)<800"],
},
```

- Values are the rig's call (defaults proposed here; see §8).
- Exit-code discipline (important): k6 exits non-zero when a threshold fails
  (threshold-failure exit, 99). The controller's load stages must treat that
  specific exit as a **recorded signal** (`thresholdsFailed: [...]` in
  `load.json` / a `capacity` artifact), never as a stage error — the stage
  stays non-fatal. Verify the exact code on the host during implementation;
  match on "threshold exit", not a bare `code !== 0`.
- Summary plumbing: switch both scripts to `handleSummary` (write the same
  file names via `__ENV.SUMMARY_FILE`), because the legacy export shape does
  not carry threshold results; `handleSummary` data does
  (`data.metrics.<m>.thresholds`). The controller already parses the summary
  JSON — extend it to lift threshold results into the artifacts.
- Viewer: ✓/✗ badge per threshold next to the load numbers.

### K3 — execute the capacity ladder with `constant-arrival-rate` (the tip-over instrument)

New controller stage `capacity` (non-fatal, selected by the config's
`stages.load` — it _is_ the load family), executed after the existing read
leg, per variant, **only when the config declares a `capacity` scenario**
(smoke declares none → stage skipped cleanly).

- For each rate `r` in `ratesPerSecond` (ascending), one k6 run of a new
  `load/capacity.js`:
  - `executor: "constant-arrival-rate"`, `rate: r`, `timeUnit: "1s"`,
    `duration: durationPerStepSeconds`, `preAllocatedVUs: preallocatedVUs`,
    `maxVUs: maxVUs` — the 1:1 mapping from the schema.
  - Iteration body: pick an operation by `weights` (list/detail → GET read
    paths; create/update/delete → the captured write requests, same replay
    machinery as `mutations.js`, same leased pools). This makes the ladder
    the _weighted mixed_ load the config declares, not a pure-read ladder.
  - `resetBefore` on the scenario: reset once before the ladder (between
    steps: **no** reset — the point is sustained pressure; document this).
  - Generator-saturation sampling unchanged; additionally record
    `dropped_iterations` per step — with generator CPU under the limit,
    dropped iterations mean the **app** couldn't absorb the rate: that is
    the tipping point, made measurable.
- Artifacts per variant: `capacity/<rate>.json` per step (rate, achieved
  req/s, p95, p99, error rate, dropped iterations, VUs used, generator CPU,
  per-op breakdown) + a reduced `capacity.json` (all steps) that the viewer
  builder embeds.
- `load/capacity.js` uses `handleSummary` + labelled thresholds (K2 rules).
- Honest labels in the viewer: this is **read-weighted mixed capacity** —
  it still makes no mutation-_capacity_ claim (mutations remain a closed-loop
  volume measurement); GraphQL variant has no read paths → ladder runs its
  write-capable routes only if the manifest targets exist, else the stage is
  recorded as not-applicable (blank, not zero).
- Configs: `medium-load.yaml` / `heavy-load.yaml` already declare the
  ladders — no config change needed. Optionally add a small
  `capacity` scenario to `smoke-matrix.yaml` (§8) so the dashboard has three
  levels of ladder data.

---

## 3bis. Work package R — resource envelopes (hardware-limitation testing)

Goal (user-confirmed, 10 Oct 2026): the same load config run under different
hardware envelopes — e.g. `medium-load @ 2c/2g` vs `medium-load @ 4c/4g`, and
`heavy-load @ 2c/2g` to find where each architecture becomes memory- or
CPU-bound — with the envelope chosen at run time, everything else identical,
and the run's provenance reflecting it. Target end state: the same rig on an
Ubuntu host (DigitalOcean droplet), where the cgroup limits are enforced
natively by the same kernel class as production.

### R1 — a run-time resource override, folded in _before_ hashing

- CLI: `--resources <spec>` on `rig:run`, two forms:
  - **envelope** (the common case): `--resources cpus=2,memoryMb=2048` → sets
    all four fields (`appCpus`/`dbCpus` = `cpus`, `appMemoryMb`/`dbMemoryMb` =
    `memoryMb`).
  - **granular**: `--resources appCpus=2,appMemoryMb=2048,dbCpus=1,dbMemoryMb=1024`
    (same key names as the YAML block).
- Env-var form for scripted/SSH use (the requested env-var path):
  `BENCH_RESOURCES="cpus=2,memoryMb=2048"` — the CLI flag wins when both are set.
- **Provenance rule (critical):** the override is applied to the parsed config
  **before** `effectiveRunManifest(config)` hashing, so `effective-config.yaml`
  carries the envelope, the `effectiveManifestSha256` differs between
  `medium-load @ 2c/2g` and `@ 4c/4g`, and the viewer's Inputs card shows it
  with no special casing. The override is also recorded in `preflight.json`
  (`resourcesRequested: {…, overridden: true}`) and echoed on the console
  ("resource envelope: 2 CPU / 2048 MB per app+db service (overridden)").
- Validation: same rules as the YAML block (positive integers); an unknown
  key in the spec is rejected (strictness discipline).

### R2 — a known confound, documented and made explicit

The closed-loop load legs derive VUs from `appCpus` (`vus = appCpus × 2`,
`src/controller/cli.ts`), so an envelope override also changes the offered
load — "same load, different hardware" does **not** hold for the volume leg
under an override. Two honest options, decided in §8:

- (a) keep current semantics (VUs follow the envelope — "load scales with
  hardware", defensible, zero code); or
- (b) pin VUs to the config's _original_ `appCpus` when the envelope is
  overridden ("same offered load, different hardware" — one small change in
  the load wiring).

Either way, the **K3 capacity ladder is the hardware-independent instrument**:
its load is defined by a target arrival _rate_, not VUs, so envelope
comparisons should lean on it. The viewer labels both (VU count and rate) on
the inputs table, so the confound is visible, never hidden.

### R3 — host/deployment notes (the DigitalOcean end state)

- **macOS (Docker Desktop)**: limits are enforced inside the VM; numbers stay
  _indicative single-host_ (house label). The VM's total budget (Docker
  Desktop settings) must exceed one stack's envelope + seeder + k6 (stacks
  run serially — only one at a time). E.g. envelope 2c/2g per service →
  app 2c/2g + db 2c/2g + uncapped seeder/k6 bursts → a 6–8 GB VM is safe.
- **Ubuntu (native, the droplet)**: cgroups enforce limits directly; this is
  the authoritative environment for hardware-limitation claims and the stated
  end goal. Same commands, same artefact layout (clone repo, `pnpm install`,
  Docker Engine + compose v2 plugin, `pnpm rig:run --config … --resources …`).
  Runs land in the server's `testing-rig/results/`; `pnpm report:all` there
  regenerates the viewer — copy the whole `results/` tree back (rsync) to
  merge server runs into the local viewer, or open it on the server.
- The rig never resizes the host or the Docker Desktop VM (§7); it limits
  **containers**, and only within a stack it owns.

### R4 — compare-view identity includes the envelope

V-B's load levels (§5) become `(configName × envelope)` — `medium-load @
2c/2g` and `medium-load @ 4c/4g` are **different levels**, not the same one
quietly averaged. With R1's provenance the envelope is readable from each
run's `inputs.resources`, so this is a display change only.

## 4. Work package V-A — graphs in the run view (inline SVG only)

- One small chart module in the viewer (vanilla): **bars** (cohort-grouped,
  per metric) and **lines** (for V-B). Scales: ms / ops-per-s / count; axis
  ticks rounded, 1 decimal; tooltips via `title` (keeps it dependency-free).
- Charts per run (each sits _above_ its table, which stays the truth):
  - Render: first-useful-data p50 bars, grouped by cohort, one bar per
    variant (+ TTFB as a second series toggle).
  - Read load: ops/s bars per variant; p95 bars per variant (K1: per-path
    small multiples).
  - Mutations: per-op rate bars (create/update/delete series per variant).
  - Capacity (after K3): per-rate line chart — achieved req/s vs target, and
    p95 vs rate, per variant. This single chart is the "does it tip over"
    picture for one run.
- Tests: the viewer tests assert on generated SVG (bar counts, labels,
  blank-input no-chart) — no browser needed in unit tests; manual gate is
  opening the page.

## 5. Work package V-B — the compare dashboard

All client-side, over the payload the page already embeds.

- **Mode toggle** (`Run` / `Compare`) in the header; compare state in the
  hash: `#compare=<runId>,<runId>[&metric=ops]` — deep-linkable, like runs.
- **Run multi-select**: checkbox list (same labels as the select). Runs are
  grouped into **load levels by `configName × resource envelope`** (R4 —
  `medium-load @ 2c/2g` ≠ `medium-load @ 4c/4g`; multiple runs of the same
  pair → latest wins, older ones listed as alternates; runs without a config
  name group by run-id).
- **Level ordering**: derive an ordinal from the inputs (fixture
  `taskCount`, then total volume counts, then max `ratesPerSecond`; envelope
  is a _separate axis_, never folded into the load ordinal) and _show the
  derivation_ in the inputs table — the label (smoke / medium / heavy, @
  Nc/Mg) is the headline, the numbers are the proof.
- **Inputs table**: rows = the compared configs' input fields (fixture
  counts, scenario declarations, concurrency, resources, `stages`), columns
  = levels, differing cells highlighted.
- **Metric grid**: per metric, variant rows × level columns; leader
  highlighted per row (per-metric only); blank/withheld rules as §2;
  correctness and threshold badges included as columns.
- **Scaling charts**: x = levels, y = metric, one line per variant; cohort
  filter + variant picker (14 lines is too many by default — default to
  cohort-coloured lines with a variant filter).
- **Tip-over badges** (facts, not scores), per variant, derived from the
  grid: error rate > 0 at level L; p95 ≥ 4× the previous level; throughput
  flat/declining across levels; `dropped_iterations` > 0 with generator CPU
  under limit; generator-saturated (withheld); correctness fail at L.
  Each badge names the level and the fact ("p95 ×4.2 at heavy").
- **Comparison honesty strip**: warns on differing `gitRevision`,
  `effectiveManifestSha256`, variant sets, or stages missing in some
  compared runs (reuses D2's `requestedStages` logic).

Tests (`tests/viewer.test.ts` extend): level grouping and ordering from
synthesised runs; grid cells for present/absent/withheld; badge derivations
(each trigger, and non-triggers); hash round-trip; honesty strip conditions;
SVG assertions for the scaling chart.

---

## 6. Implementation order and gates

| Step | Work                                                                        | Gate (must actually pass)                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | K1 per-path tags + K2 thresholds + `handleSummary`                          | `pnpm test`; `pnpm typecheck`; rehearsal `pnpm rig:run --config config/medium-load.yaml --only next-actions` → `load.json`/`mutations-summary.json` carry per-path p95 and threshold results; threshold-failure exit recorded, stage still `ok` (prove by a deliberately impossible threshold in a throwaway run)                                                                                                   |
| 2    | V-A charts (run view)                                                       | `pnpm test` (SVG assertions); open `results/index.html` → charts render for a fully-measured run; a lifecycle-only run shows no empty chart shells                                                                                                                                                                                                                                                                  |
| 3    | K3 capacity ladder                                                          | `pnpm test`; `pnpm typecheck`; rehearsal `--only next-actions,tanstack-express-rest` (medium-load) → `capacity/*.json` per rate; achieved ≈ target at low rates; a high rate shows either degraded p95 or dropped iterations; no generator saturation at low rates                                                                                                                                                  |
| 4    | R resource envelopes: `--resources` + `BENCH_RESOURCES`, folded in pre-hash | `pnpm test`; `pnpm rig:run --config config/medium-load.yaml --only next-actions --resources cpus=2,memoryMb=2048` → `effective-config.yaml` shows 2c/2g, the `effectiveManifestSha256` **differs** from the same config without the override, `preflight.json` records the override, and `docker inspect` on the running app/db containers confirms the cgroup limits; repeat with the `BENCH_RESOURCES=…` env form |
| 5    | V-B compare dashboard                                                       | `pnpm test`; with two+ existing runs of different configs: grid, inputs table, scaling chart, badges, honesty strip all render; hash deep-link round-trips; two runs of the same config with different envelopes render as **distinct levels**                                                                                                                                                                      |
| 6    | Full ladder + envelope runs (user-scheduled)                                | `pnpm rig:run --config config/medium-load.yaml` then `heavy-load.yaml` → 14/14 ok each → compare view shows three levels (smoke + these) with tip-over badges; then the envelope matrix on the Ubuntu host — `medium-load` and `heavy-load` each at `--resources cpus=2,memoryMb=2048` (optionally 4c/4g) → load × envelope levels in the compare view                                                              |
| 7    | Docs + handoff                                                              | `testing-rig/README.md` (capacity stage, resource override + Ubuntu/DO run recipe, compare view), `src/reporting/README.md`, `load/README.md`, `docs/agent-handoff.md` milestone entry with the §1 audit table updated to "adopted"                                                                                                                                                                                 |

Files touched: `load/read.js`, `load/mutations.js`, new `load/capacity.js`,
`src/controller/lifecycle.ts` (capacity stage, threshold-exit handling,
per-path/threshold lifting), `src/controller/cli.ts` (stage wiring,
`--resources` parsing applied pre-hash, `BENCH_RESOURCES`),
`src/reporting/viewer.ts` (charts, compare mode, envelope-aware levels),
`tests/viewer.test.ts` (+ a resource-spec parse test),
`config/smoke-matrix.yaml` (only if §8's smoke-ladder is confirmed), READMEs.
**No app changes. No compose-file changes** — every stack already templates
`deploy.resources.limits` on the injected env vars (§1.4). **No new npm
dependencies.** k6 itself is already pinned via
the `grafana/k6` image — verify the image's k6 version supports
`constant-arrival-rate` + `handleSummary` (any modern release does; both are
long-standing features) during step 3's rehearsal and record it in the
handoff.

---

## 7. Non-goals

- k6/Grafana Cloud, AI insights, or any network-dependent k6 feature — the
  rig runs the pinned local image only.
- k6 browser module — render is owned by the Playwright collector (plan §6.4);
  do not double-measure. (Re-confirmed: the collector's pinned Chromium is the
  render instrument; the k6 browser module would double-measure the same
  thing at higher generator cost.)
- Host-level resource automation — the rig limits **containers** within stacks
  it owns; it never resizes the Docker Desktop VM, the droplet, or any host.
  Host/VM budgets are documented (R3), not managed.
- External chart libraries or CDN assets in the viewer (offline rule).
- A composite "best" or "winner" score across levels — badges are per-metric
  facts only.
- A mutation-_capacity_ claim: the ladder is read-weighted mixed capacity and
  is labelled as such; mutations stay a closed-loop volume measurement.
- Cross-run aggregation beyond the client-side compare view — no database,
  no server, runs stay immutable artifacts.

## 8. Open decisions (confirm before steps 1/3/5)

1. **Threshold defaults** — proposed: `http_req_failed rate<0.01`,
   `http_req_duration p(95)<800` (ms) for read + capacity; `p(95)<1500` for
   mutations. These are _labels_; picking wrong values is cheap to change.
2. **Smoke ladder** — add a small `capacity` scenario to `smoke-matrix.yaml`
   (e.g. rates `[5, 10]`, 30 s steps) so all three levels have ladder data,
   at the cost of ~1 min per variant? Recommended yes.
3. **Compare default metric** — which metric the scaling chart opens on
   (proposed: read ops/s; alternatives: p95, render first-data).
4. **Ladder reset policy** — reset before the ladder only (recommended,
   sustained pressure across steps) vs reset between steps (cleaner
   per-step isolation, weaker tip-over signal).
5. **Envelope vs offered load (R2)** — (a) VUs follow the envelope (current
   semantics, "load scales with hardware", zero code) or (b) VUs pinned to
   the config's original `appCpus` under an override ("same offered load,
   different hardware", one small change). Recommended (b), with the capacity
   ladder as the primary cross-envelope instrument either way.
6. **Seeder/k6 caps** — leave both uncapped (recommended; not the system under
   test, and the saturation monitor guards the generator) vs capping the
   seeder so tiny-envelope hosts don't thrash during seed.
7. **Envelope run matrix on the droplet** — which cells to schedule first
   (proposed: `medium-load` and `heavy-load` each at 2c/2g and 4c/4g — four
   full-matrix runs, hours of wall clock; confirm before scheduling).
