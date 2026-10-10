# Controller (plan §5)

The per-variant lifecycle state machine. One variant = one Compose stack,
driven serially on an idle host (plan §7). It never executes a shell string:
every Compose invocation goes through `execFile` with an argument array, and
command arrays in manifests are a design shape the controller resolves itself.

## Modules

| File           | Responsibility                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.ts`       | Entry point (`pnpm rig:run`): parse args, load + cross-check config and manifests, preflight eligibility, plan variants, run them, write artefacts.                                                                                                                             |
| `matrix.ts`    | Entry point (`pnpm rig:matrix`): run every `config/<load>-<env>.yaml` cell in one go (sequential). Pure `planMatrix` + spawn loop.                                                                                                                                              |
| `types.ts`     | `ResolvedVariant`/`ResolvedService`, `CommandResult`, `CommandError`.                                                                                                                                                                                                           |
| `docker.ts`    | `runCommand` (execFile wrapper) and the `Compose` class (`build`/`up`/`down`/`runService`/`exec`/`images`/`ps`/`logs`).                                                                                                                                                         |
| `ports.ts`     | Distinct free host-port allocation, once per (run, variant).                                                                                                                                                                                                                    |
| `tokens.ts`    | `{{TOKEN}}` resolution for build args (e.g. the SPA's `VITE_API_URL`).                                                                                                                                                                                                          |
| `plan.ts`      | Manifest → `ResolvedVariant` (absolute paths, run-unique project name, allocated ports, resolved build args) and the Compose environment (`composeEnv`).                                                                                                                        |
| `fixture.ts`   | Eligibility pools and the pre-timing eligibility check (spec/seed-spec.md).                                                                                                                                                                                                     |
| `verify.ts`    | Independent verification through `docker compose exec -T db psql`: schema facts (indexes/constraints/columns) and a canonical export digest.                                                                                                                                    |
| `lifecycle.ts` | The state machine: `build → up → ready → reset → seed → verifySchema → verifyDigest → correctness? → render? → load? (read + mutations + capacity) → teardown`, all stages recorded, teardown in `finally`.                                                                     |
| `sampler.ts`   | Container CPU/RAM sampler: a 1 Hz loop around each load leg over the Docker Engine API (`GET /containers/{id}/stats`, raw counters) with a `docker stats` CLI fallback; pure counter math (cores, percent-of-envelope, working set, OOM delta) + folding to per-leg aggregates. |
| `resources.ts` | `parseResourcesSpec` — the `--resources` / `BENCH_RESOURCES` envelope override, folded into the parsed config _before_ hashing (plan R1).                                                                                                                                       |
| `artifacts.ts` | Everything written under `results/<run-id>/`.                                                                                                                                                                                                                                   |

## What the controller injects into a stack

Compose environment (referenced by each `compose.yaml`):

- `POSTGRES_URL=postgresql://bench:bench@db:5432/bench`
- `APP_PORT` / `API_PORT` / `SPA_PORT` (allocated per run; the manifest names them)
- `APP_CPUS`, `APP_MEMORY_MB`, `DB_CPUS`, `DB_MEMORY_MB`
- `CORS_ORIGIN` (`spa-api` only) and any manifest `buildArgs` (e.g. `VITE_API_URL`)

The seeder is run as `docker compose run --rm -e SEED_FIXTURE=<json> seeder seed`,
with `reset`/`verify` available.

## Run

```bash
cd testing-rig
pnpm rig:run --config config/small-1c1g.yaml                  # all 14 variants
pnpm rig:run --config config/medium-2c2g.yaml --only next-actions
pnpm rig:run --config config/large-4c4g.yaml --only next-actions --no-build
pnpm rig:matrix                                               # small/medium/large × 1c1g/2c2g/4c4g
```

Flags: `--config`, `--manifests`, `--only id[,id]`, `--no-build`, `--no-cache`,
`--skip-seeder-build`, `--readiness-timeout <ms>`, `--resources <spec>`
(`BENCH_RESOURCES` is the env fallback), plus the one-off upward stage overrides
`--with-correctness` / `--with-render` / `--with-load`. `rig:matrix` takes
`--loads`, `--envelopes`, `--dry-run` and forwards the pass-through flags.

**Stage selection is config-driven** (plan D4): `stages: { correctness, render,
load }` in the YAML decides what runs (defaults all-off, so every existing config
stays valid). The effective selection is written to `preflight.json#stages`
(plan D1), alongside `only` and `resourcesRequested`.

## Notes

- The load stage runs the read leg, the captured-request mutation replay, and
  the constant-arrival-rate **capacity ladder** (plan K3) — all non-fatal; k6's
  threshold-failure exit is recorded as a label, never a stage error.
- Each load leg also samples the stack's app/api/spa/db containers and the
  `bench-k6-*` generator (plan: container-resource-usage-tracking). The folded
  aggregates land in `load.json` / `mutations.json` / `capacity/<rate>.json` as
  `resources` (percent of the service's `resources:` envelope, not of host); the
  raw 1 Hz series land under `resources/` only when `report.keepRawSamples` is
  set. The generator's `generatorMaxCpuPercentObserved` is derived from this same
  pass. A sampling failure is recorded as `resources: null`, never fatal.
- A resource-envelope override pins the read VUs to the config's original
  `appCpus` so the offered load is held constant (plan R2).
