# Controller (plan §5)

The per-variant lifecycle state machine. One variant = one Compose stack,
driven serially on an idle host (plan §7). It never executes a shell string:
every Compose invocation goes through `execFile` with an argument array, and
command arrays in manifests are a design shape the controller resolves itself.

## Modules

| File           | Responsibility                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.ts`       | Entry point (`pnpm rig:run`): parse args, load + cross-check config and manifests, preflight eligibility, plan variants, run them, write artefacts.                                                         |
| `types.ts`     | `ResolvedVariant`/`ResolvedService`, `CommandResult`, `CommandError`.                                                                                                                                       |
| `docker.ts`    | `runCommand` (execFile wrapper) and the `Compose` class (`build`/`up`/`down`/`runService`/`exec`/`images`/`ps`/`logs`).                                                                                     |
| `ports.ts`     | Distinct free host-port allocation, once per (run, variant).                                                                                                                                                |
| `tokens.ts`    | `{{TOKEN}}` resolution for build args (e.g. the SPA's `VITE_API_URL`).                                                                                                                                      |
| `plan.ts`      | Manifest → `ResolvedVariant` (absolute paths, run-unique project name, allocated ports, resolved build args) and the Compose environment (`composeEnv`).                                                    |
| `fixture.ts`   | Eligibility pools and the pre-timing eligibility check (spec/seed-spec.md).                                                                                                                                 |
| `verify.ts`    | Independent verification through `docker compose exec -T db psql`: schema facts (indexes/constraints/columns) and a canonical export digest.                                                                |
| `lifecycle.ts` | The state machine: `build → up → ready → reset → seed → verifySchema → verifyDigest → correctness? → render? → load? (read + mutations + capacity) → teardown`, all stages recorded, teardown in `finally`. |
| `resources.ts` | `parseResourcesSpec` — the `--resources` / `BENCH_RESOURCES` envelope override, folded into the parsed config _before_ hashing (plan R1).                                                                   |
| `artifacts.ts` | Everything written under `results/<run-id>/`.                                                                                                                                                               |

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
pnpm rig:run --config config/smoke-matrix.yaml                 # all 14 variants
pnpm rig:run --config config/smoke-matrix.yaml --only next-actions
pnpm rig:run --config config/default.yaml --only next-actions --no-build
```

Flags: `--config`, `--manifests`, `--only id[,id]`, `--no-build`, `--no-cache`,
`--skip-seeder-build`, `--readiness-timeout <ms>`, `--resources <spec>`
(`BENCH_RESOURCES` is the env fallback), plus the one-off upward stage overrides
`--with-correctness` / `--with-render` / `--with-load`.

**Stage selection is config-driven** (plan D4): `stages: { correctness, render,
load }` in the YAML decides what runs (defaults all-off, so every existing config
stays valid). The effective selection is written to `preflight.json#stages`
(plan D1), alongside `only` and `resourcesRequested`.

## Notes

- The load stage runs the read leg, the captured-request mutation replay, and
  the constant-arrival-rate **capacity ladder** (plan K3) — all non-fatal; k6's
  threshold-failure exit is recorded as a label, never a stage error.
- A resource-envelope override pins the read VUs to the config's original
  `appCpus` so the offered load is held constant (plan R2).
