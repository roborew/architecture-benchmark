# Controller (plan §5)

The per-variant lifecycle state machine. One variant = one Compose stack,
driven serially on an idle host (plan §7). It never executes a shell string:
every Compose invocation goes through `execFile` with an argument array, and
command arrays in manifests are a design shape the controller resolves itself.

## Modules

| File           | Responsibility                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.ts`       | Entry point (`pnpm rig:run`): parse args, load + cross-check config and manifests, preflight eligibility, plan variants, run them, write artefacts.      |
| `types.ts`     | `ResolvedVariant`/`ResolvedService`, `CommandResult`, `CommandError`.                                                                                    |
| `docker.ts`    | `runCommand` (execFile wrapper) and the `Compose` class (`build`/`up`/`down`/`runService`/`exec`/`images`/`ps`/`logs`).                                  |
| `ports.ts`     | Distinct free host-port allocation, once per (run, variant).                                                                                             |
| `tokens.ts`    | `{{TOKEN}}` resolution for build args (e.g. the SPA's `VITE_API_URL`).                                                                                   |
| `plan.ts`      | Manifest → `ResolvedVariant` (absolute paths, run-unique project name, allocated ports, resolved build args) and the Compose environment (`composeEnv`). |
| `fixture.ts`   | Eligibility pools and the pre-timing eligibility check (spec/seed-spec.md).                                                                              |
| `verify.ts`    | Independent verification through `docker compose exec -T db psql`: schema facts (indexes/constraints/columns) and a canonical export digest.             |
| `lifecycle.ts` | The state machine: `build → up → ready → reset → seed → verifySchema → verifyDigest → teardown`, all stages recorded, teardown in `finally`.             |
| `artifacts.ts` | Everything written under `results/<run-id>/`.                                                                                                            |

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
`--skip-seeder-build`, `--readiness-timeout <ms>`.

## Not yet implemented (plan R5–R8)

The lifecycle stops after `verifyDigest`; browser correctness/render suites (R5,
R6), k6 load adapters and telemetry (R7), and the decision-matrix generator (R8)
are not wired in. The stage recorder and `results/<run-id>/` layout are shaped to
accept them without restructuring.
