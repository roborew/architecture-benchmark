# testing-rig

The benchmark controller for the architecture-comparison repo. It runs each
variant as its own Docker Compose stack, loads an identical canonical fixture
via a rig-owned seeder, independently verifies the schema and data, and writes
everything under `results/<run-id>/`.

## Commands

```bash
pnpm install

# Validate configs + every variant manifest (no Docker):
pnpm config:validate config/default.yaml manifests

# Run a matrix (needs the Docker daemon). Stage selection lives in the config
# (`stages:`), so the canonical command is just the config:
# smoke-matrix = reduced first pass; medium-load / heavy-load = quick mid/max profiles.
pnpm rig:run --config config/smoke-matrix.yaml
pnpm rig:run --config config/medium-load.yaml
pnpm rig:run --config config/default.yaml --only next-actions

# One-off upward stage overrides for rehearsals (the config normally decides):
pnpm rig:run --config config/medium-load.yaml --with-load --with-render

# Resource envelope (hardware-limitation testing), folded in before hashing:
pnpm rig:run --config config/medium-load.yaml --resources cpus=2,memoryMb=2048
BENCH_RESOURCES="cpus=4,memoryMb=4096" pnpm rig:run --config config/heavy-load.yaml

pnpm test        # the rig's own tests (no Docker)
pnpm typecheck

# Turn a run's raw data into the decision matrix (CSV/MD/HTML):
pnpm report                    # most recent run
pnpm report <run-id>

# Rebuild the single results page over every run:
pnpm report:all                # → results/index.html
```

### Measurement stages

Stage selection is **config-driven** (`stages:` in the YAML), so
`pnpm rig:run --config <cfg>` runs everything the config asks for. The CLI
`--with-*` flags remain as one-off _upward_ overrides.

| Stage         | What it runs                                                                 | On failure                     | Rough cost/variant |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------ | ------------------ |
| `correctness` | shared black-box Playwright CRUD suite (`e2e/correctness.spec.ts`)           | **fatal** — variant ineligible | ~1–2 min           |
| `render`      | pinned-Chromium render collector (`src/render/collect.ts`)                   | non-fatal — recorded           | ~2–5 min           |
| `load`        | k6 read leg **+** captured-request mutation replay **+** the capacity ladder | non-fatal — recorded/withheld  | ~2–6 min           |

Every shipped config (`default`, `smoke-matrix`, `medium-load`, `heavy-load`) sets all
three to `true`; `config/examples/volume-1000-writes.yaml` stays lean (all off).
The effective selection is recorded in `preflight.json#stages`, so the viewer can
tell "not requested" from "attempted and failed".

### Resource envelopes (hardware-limitation testing)

`--resources <spec>` (or `BENCH_RESOURCES="…"`; the flag wins) overrides the
stack's CPU/RAM caps _before_ the effective-config hash is computed, so
`medium-load @ 2c/2g` and `medium-load @ 4c/4g` are distinct runs with distinct
`effectiveManifestSha256` values. Two forms:

- envelope — `cpus=2,memoryMb=2048` (sets app + db)
- granular — `appCpus=2,appMemoryMb=2048,dbCpus=1,dbMemoryMb=1024`

Under an override the closed-loop read VUs are pinned to the config's original
`appCpus` (same offered load, different hardware, plan R2). The capacity ladder
(rate-defined) is the preferred cross-envelope instrument. The rig limits
**containers** only; it never resizes the host or the Docker Desktop VM.

## Layout

| Path              | What it is                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config/`         | Experiment YAML. `smoke-matrix.yaml` (reduced first pass), `medium-load.yaml` / `heavy-load.yaml` (quick mid/max profiles), `default.yaml` (full run). |
| `manifests/`      | One schema-v2 manifest per variant (14 DB-backed variants; `next-template` is excluded).                                                               |
| `seeder/`         | The canonical fixture-loader image (`bench-seeder`), built once and used by every stack.                                                               |
| `src/config/`     | Strict Zod schemas, loaders, effective-run-manifest hashing, the `config:validate` CLI.                                                                |
| `src/controller/` | The lifecycle state machine (see `src/controller/README.md`).                                                                                          |
| `src/fixtures/`   | The canonical fixture generator (algorithm v1).                                                                                                        |
| `src/reporting/`  | Decision-matrix generation (`pnpm report`), the results viewer (`pnpm report:all`), and the static/complexity inventory.                               |
| `results/`        | Git-ignored run artefacts (effective config, per-variant lifecycle, logs, digests).                                                                    |

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
