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

# Run a matrix (needs the Docker daemon):
pnpm rig:run --config config/smoke-matrix.yaml
pnpm rig:run --config config/default.yaml --only next-actions

pnpm test        # the rig's own tests (no Docker)
pnpm typecheck

# Turn a run's raw data into the decision matrix (CSV/MD/HTML):
pnpm report                    # most recent run
pnpm report <run-id>
```

## Layout

| Path              | What it is                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `config/`         | Experiment YAML. `smoke-matrix.yaml` is the reduced first-pass budget; `default.yaml` is the full run. |
| `manifests/`      | One schema-v2 manifest per variant (14 DB-backed variants; `next-template` is excluded).               |
| `seeder/`         | The canonical fixture-loader image (`bench-seeder`), built once and used by every stack.               |
| `src/config/`     | Strict Zod schemas, loaders, effective-run-manifest hashing, the `config:validate` CLI.                |
| `src/controller/` | The lifecycle state machine (see `src/controller/README.md`).                                          |
| `src/fixtures/`   | The canonical fixture generator (algorithm v1).                                                        |
| `src/reporting/`  | Decision-matrix generation (`pnpm report`) and the static/complexity inventory.                        |
| `results/`        | Git-ignored run artefacts (effective config, per-variant lifecycle, logs, digests).                    |

## How a run works

1. Validate the experiment config and cross-check `variants:` against
   `manifests/`; refuse impossible eligibility plans up front.
2. Build `bench-seeder:local` once, then each variant's image(s).
3. For each variant, serially: `compose up` → wait for every published health
   path → `seeder reset` → `seeder seed` (reproduces the golden digest) →
   independent `psql` schema + export-digest verification → `compose down -v`.
4. Write `effective-config.yaml`, `run-manifest.json`, per-variant
   `lifecycle.json`, and `summary.json`.

The primary output — the decision matrix — is generated from this raw data
(plan §6.6, `src/reporting/`).
