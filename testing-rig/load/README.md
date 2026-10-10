# Load suite (plan §6.5, K1–K3)

Three k6 scripts, run in the pinned `grafana/k6` image **on the stack network**.
The controller runs them as non-fatal `load` stages.

| Script         | What it is                                                                                |
| -------------- | ----------------------------------------------------------------------------------------- |
| `read.js`      | read-capacity leg: `constant-vus`, cycles the manifest's read paths                       |
| `mutations.js` | mutation volume: replays captured write requests at exact per-op counts (leased pool ids) |
| `capacity.js`  | the **capacity ladder** (R8/K3): `constant-arrival-rate`, one call per declared rate      |
| `summary.js`   | shared `handleSummary` writer (see below)                                                 |

All three use `handleSummary` (via `summary.js`) rather than the legacy
`--summary-export`, because only `handleSummary` carries threshold results. The
summary is flattened (`data.metrics[name].values` spread to the top level) and
carries a top-level `thresholds` array, so the controller/viewer read it as-is.

## Thresholds are labels, not gates (plan K2)

`options.thresholds` (e.g. `http_req_failed: ["rate<0.01"]`,
`http_req_duration: ["p(95)<800"]`) are recorded with `abortOnFail` left false.
k6 exits **99** when a threshold fails; the controller treats that as a recorded
signal (`thresholdsFailed` labels in `load.json` / `capacity.json`), never as a
stage error. The viewer shows ✓/✗ badges.

## Per-path latency (plan K1)

`read.js` tags every request `tags: { path }`, so the summary carries
`http_req_duration{path:…}` sub-metrics. The controller lifts them into a
per-path p50/p95 map in `load.json`; the viewer renders a per-path breakdown.

## Capacity ladder (plan K3)

`capacity.js` is run once per rate in the config's `capacity` scenario
(`constant-arrival-rate`, `preAllocatedVUs`/`maxVUs` from the scenario). The
iteration body picks an op by `weights`: list/detail are GETs over the read
paths; create/update/delete replay the captured writes with the same leased
pools as `mutations.js`. `resetBefore` resets once _before_ the ladder — never
between steps (sustained pressure is the point). With the generator's CPU under
the limit, dropped iterations (or a degraded p95) mark the app's tipping point.
This is **read-weighted mixed capacity** — it makes no mutation-capacity claim.
Artefacts: `variants/<id>/capacity/<rate>.json` per step + `capacity.json`.

The read leg runs first, then mutations (which produces the capture the ladder
reuses), then the ladder.

## How the controller runs them

- Target service comes from the manifest's `load: { service, paths }`.
- `docker run -d --name bench-k6-<id> --network <project>_default
--add-host host.docker.internal:host-gateway … grafana/k6 run <script>`; the
  controller passes `SUMMARY_FILE=/out/<name>.json` (the script writes there).
- The generator's CPU is sampled with `docker stats`; a run whose generator
  exceeds `load.generatorMaxCpuPercent` is marked **saturated** and its number is
  withheld (a saturated generator measures itself).
- `pg_stat_statements` totals are snapshotted before/after (`delta`).

## Known limitations

- **Read-only capacity claim.** Writes in the ladder are replayed captured
  requests, so they are not a per-transport mutation-capacity measurement.
- At high sustained rates the delete pool cycles (`i % span`), so a very high
  rate can surface delete 404s — a pool-size artefact, labelled honestly.
- Single host, single generator — indicative; serious saturation needs a
  separate load-generator machine (plan §7).
