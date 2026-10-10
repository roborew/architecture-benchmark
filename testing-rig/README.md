# testing-rig

The benchmark controller for the architecture-comparison repo. It runs each
variant as its own Docker Compose stack, loads an identical canonical fixture
via a rig-owned seeder, independently verifies the schema and data, and writes
everything under `results/<run-id>/`.

## Commands

```bash
pnpm install

# Validate configs + every variant manifest (no Docker):
pnpm config:validate config/medium-2c2g.yaml manifests

# Run one cell of the matrix (needs the Docker daemon). Stage selection lives in
# the config (`stages:`), so the canonical command is just the config:
#   <load>-<env>.yaml  =  small|medium|large  ×  1c1g|2c2g|4c4g
pnpm rig:run --config config/small-1c1g.yaml
pnpm rig:run --config config/medium-2c2g.yaml
pnpm rig:run --config config/large-4c4g.yaml --only next-actions

# Run the WHOLE matrix (every load level × resource envelope) in one go:
pnpm rig:matrix
pnpm rig:matrix --loads small,medium --envelopes 2c2g,4c4g
pnpm rig:matrix --dry-run            # print the plan, run nothing

# One-off upward stage overrides for rehearsals (the config normally decides):
pnpm rig:run --config config/medium-2c2g.yaml --with-load --with-render

# Ad-hoc envelope override, folded in before hashing (alternative to a file):
pnpm rig:run --config config/medium-2c2g.yaml --resources cpus=4,memoryMb=4096
BENCH_RESOURCES="cpus=4,memoryMb=4096" pnpm rig:run --config config/large-2c2g.yaml

pnpm test        # the rig's own tests (no Docker)
pnpm typecheck

# Turn a run's raw data into the decision matrix (CSV/MD/HTML):
pnpm report                    # most recent run
pnpm report <run-id>

# Rebuild the single results page over every run:
pnpm report:all                # → results/index.html
```

### The load × resource matrix

The `config/` directory holds one file per **load level × resource envelope**,
named `<load>-<env>.yaml`:

| Load level | Fixture     | Envelopes (app + db CPUs / RAM) |
| ---------- | ----------- | ------------------------------- |
| `small`    | 1 k tasks   | `1c1g`, `2c2g`, `4c4g`          |
| `medium`   | 10 k tasks  | `1c1g`, `2c2g`, `4c4g`          |
| `large`    | 100 k tasks | `1c1g`, `2c2g`, `4c4g`          |

Each file bakes its resource caps into the config, so `pnpm rig:run --config
config/medium-4c4g.yaml` is a self-contained cell. `pnpm rig:matrix` runs all of
them sequentially in one command; the compare view groups the resulting runs by
`configName × envelope`.

> Note: the read leg's VUs derive from `appCpus` (VUs = `appCpus × 2`), so a
> bigger baked envelope also offers more load. To hold offered load constant and
> vary only hardware, use `--resources` against a single config instead (the
> flag pins VUs to the config's `appCpus`).

### Measurement stages

Stage selection is **config-driven** (`stages:` in the YAML), so
`pnpm rig:run --config <cfg>` runs everything the config asks for. The CLI
`--with-*` flags remain as one-off _upward_ overrides.

| Stage         | What it runs                                                                                                       | On failure                     | Rough cost/variant |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------ |
| `correctness` | shared black-box Playwright CRUD suite (`e2e/correctness.spec.ts`)                                                 | **fatal** — variant ineligible | ~1–2 min           |
| `render`      | pinned-Chromium render collector (`src/render/collect.ts`)                                                         | non-fatal — recorded           | ~2–5 min           |
| `load`        | k6 read leg **+** captured-request mutation replay **+** the capacity ladder, each with container CPU/RAM sampling | non-fatal — recorded/withheld  | ~2–6 min           |

Every shipped config sets all three stages to `true`;
`config/examples/volume-1000-writes.yaml` stays lean (all off). The effective
selection is recorded in `preflight.json#stages`, so the viewer can tell "not
requested" from "attempted and failed".

### Container CPU/RAM tracking

Every `load` leg also samples the variant's **own** containers — app/api/spa,
db, and the `bench-k6-*` generator — once per second, from the Docker Engine API
(`GET /containers/{id}/stats`, raw cumulative counters; a `docker stats` CLI
fallback when the socket is unreachable, recorded as `source: "cli"`). The
numbers are **percent of the service's `resources:` envelope**, not of the host —
the fact that answers "did this variant max out its 2-CPU envelope, or eat all
its RAM". Per leg they are folded into the existing reports:

- `variants/<id>/load.json`, `mutations.json` and `capacity/<rate>.json` gain a
  `resources: { source, services: { app: { maxCpuPctOfEnv, avgCpuPctOfEnv,
maxMemMb, maxMemPctOfEnv }, db: {…}, … }, oomKills }` block.
- The raw 1 Hz series (`resources/read-samples.json`,
  `resources/mutations-samples.json`, `resources/capacity/<rate>-samples.json`)
  is written only when the config sets `report.keepRawSamples: true`.

The decision matrix carries `app_max_cpu_pct_env` / `app_max_mem_pct_env` (the
peak across the run's load legs) and the compare view names the binding resource
at each tip-over. A container pinned at ~100 % of its envelope is a _result_, not
a validity failure — only **generator** saturation still withholds a number. A
blank cell means _not measured_, never zero.

### Resource envelopes (hardware-limitation testing)

`--resources <spec>` (or `BENCH_RESOURCES="…"`; the flag wins) overrides the
stack's CPU/RAM caps _before_ the effective-config hash is computed, so
`medium-2c2g @ 4c/4g` and `medium-4c4g` are distinct runs with distinct
`effectiveManifestSha256` values. Two forms:

- envelope — `cpus=2,memoryMb=2048` (sets app + db)
- granular — `appCpus=2,appMemoryMb=2048,dbCpus=1,dbMemoryMb=1024`

Under an override the closed-loop read VUs are pinned to the config's original
`appCpus` (same offered load, different hardware, plan R2). The capacity ladder
(rate-defined) is the preferred cross-envelope instrument. The rig limits
**containers** only; it never resizes the host or the Docker Desktop VM.

## Layout

| Path              | What it is                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `config/`         | Experiment YAML. One file per load × envelope: `small                                                                    | medium | large`×`1c1g | 2c2g | 4c4g` (`small-1c1g.yaml`…`large-4c4g.yaml`), plus `config/examples/`. |
| `manifests/`      | One schema-v2 manifest per variant (14 DB-backed variants; `next-template` is excluded).                                 |
| `seeder/`         | The canonical fixture-loader image (`bench-seeder`), built once and used by every stack.                                 |
| `src/config/`     | Strict Zod schemas, loaders, effective-run-manifest hashing, the `config:validate` CLI.                                  |
| `src/controller/` | The lifecycle state machine (see `src/controller/README.md`).                                                            |
| `src/fixtures/`   | The canonical fixture generator (algorithm v1).                                                                          |
| `src/reporting/`  | Decision-matrix generation (`pnpm report`), the results viewer (`pnpm report:all`), and the static/complexity inventory. |
| `results/`        | Git-ignored run artefacts (effective config, per-variant lifecycle, logs, digests).                                      |

## How a run works

1. Validate the experiment config and cross-check `variants:` against
   `manifests/`; refuse impossible eligibility plans up front.
2. Build `bench-seeder:local` once, then each variant's image(s).
3. For each variant, serially: `compose up` → wait for every published health
   path → `seeder reset` → `seeder seed` (reproduces the golden digest) →
   independent `psql` schema + export-digest verification → `compose down -v`.
4. Write `effective-config.yaml`, `run-manifest.json`, per-variant
   `lifecycle.json`, `summary.json`, and (per `stages:`) correctness, render,
   load (`load.json`/`k6-summary.json`/`mutations-summary.json`) and capacity
   (`capacity.json`) artefacts.
5. Refresh the results viewer (`results/index.html`) — best-effort; a reporting
   failure never fails the run.

The primary output — the decision matrix — is generated from this raw data
(plan §6.6, `src/reporting/`). The single results viewer (`results/index.html`)
has a **Run view** (charts above each table) and a **Compare view** (inputs
side-by-side, a metric grid across load levels, scaling charts and per-metric
tip-over facts). Open it directly via `file://`, no server needed.
