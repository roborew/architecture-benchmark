# Agent handoff notes

Structured record of milestone handoffs (plan §8 work instructions): after each
milestone, record files changed, architecture decisions, exact build/test
commands with actual pass/fail, schema/seed/config checks, known fairness
limitations, and next-milestone dependencies. Raw failure artifacts are
preserved under `testing-rig/results/` (gitignored, local only).

## M0 — Specification (completed, validated)

- **Files:** `spec/schema.sql`, `spec/contract.md`, `spec/queries.md`,
  `spec/seed-spec.md`, `spec/seed-profiles.yaml`, `spec/snapshots/small/*`
  (golden CSVs + `SHA256SUMS` + `manifest.json`), root `README.md`,
  `.gitignore`, `docs/`.
- **Decisions:** seed algorithm v1 is pure arithmetic (no PRNG); status cycle
  of length 100 in fixed order todo→doing→done; comments spread evenly with
  timestamps strictly after all task timestamps; canonical digest =
  SHA-256(users ∥ projects ∥ tasks ∥ comments CSV bytes); eligibility pools
  are fixed ID bands (read 1..⌊N/2⌋, update next 30%, delete final 20%).
- **Checks actually run and passed:**
  - Generator run twice → byte-identical output
    (`combinedSha256 0afdc67ef386f1b4695aecd30230dfccc345903cd84242582494480691d80700`).
  - Full DB round-trip: reset → seed (small) into a live Postgres → canonical
    export via `pnpm db:export` → **byte-identical to the golden CSVs** and the
    same combined digest. This closes the M0 determinism gate (both legs).
- **Not done:** `medium`/`large` snapshots not generated (on-demand per plan).

## M1 — Standalone template (scaffolded, validated except copy-out gate)

- **Files:** complete `apps/template-next` (see its README): Next.js 15 App
  Router, raw `node-postgres` + hand-written SQL, RSC direct-DB reads, Server
  Action mutations, keyset pagination, deterministic seed/reset/export entry
  points, golden-digest unit test, copy-out smoke script.
- **Checks actually run and passed:**
  - `pnpm test` — 8/8 (seed determinism, mapping, golden digest).
  - `pnpm typecheck` — clean; `pnpm build` — clean, all routes dynamic.
  - Query-layer integration smoke against a live Postgres (temporary DB,
    since the local Docker VM is out of disk): create (identity sequence
    advanced past fixture ids, id=1001), update (explicit `updated_at`
    advanced), create-with-comment (atomic), delete (comments cascaded via FK),
    detail/not-found.
  - Production server (`next start`) smoke over HTTP: `/healthz` 200;
    `/` lists 5 projects; `/projects/1` returns 25 rows newest-first with
    `next-page` keyset cursor; `?status=done` filters server-side;
    `/tasks/999` detail with comment; `/tasks/99999` → 404.
- **Not run:** `scripts/standalone-smoke.sh` (copy-out gate) — blocked by the
  local Docker VM having no free disk (initdb failed with "No space left
  device"). Run it on a machine with Docker disk space.
- **Known limitations:** single-stage Docker image (seeder needs dev deps);
  schema applied from `db/schema.sql` rather than versioned migrations;
  compose `db` published on `DB_PORT` default 5433 to avoid host Postgres
  collisions (the rig never relies on that port — it seeds via the seeder
  service inside the stack).

## M2 foundation — rig config + fixtures (scaffolded, validated)

- **Files:** `testing-rig` package (zod + yaml), `src/config/schema.ts`
  (strict validation, normative volume/capacity scenario split, phase-1
  `appToApiAddedRttMs` rejection), `src/config/load.ts` (effective-run-
  manifest hashing), `src/config/validate.ts` CLI, `config/default.yaml`,
  `config/examples/volume-1000-writes.yaml`, `manifests/template-next.yaml`,
  `manifests/next-actions.yaml`, `src/fixtures/generate-fixture.mjs`,
  `tests/config.test.ts`.
- **Checks actually run and passed:** `pnpm test` — 8/8 (default config,
  unknown-key rejection, workload-mapping rejection, volume/capacity
  discrimination, statusPercent sum, appToApiAddedRttMs rejection, stable
  effective manifest hash); `pnpm config:validate` on default + example
  configs and both manifests; `pnpm typecheck` clean; fixture regeneration
  byte-identical to `spec/snapshots/small`.

## M2 (controller) → R0–R4 — containerisation spine (completed, validated 9 Oct 2026)

Implemented per `docs/testing-rig-final-implementation-plan.md`. All gates run
on this host (macOS Docker Desktop, Docker 29.1.3).

- **R0 — housekeeping.** `testing-rig/package.json` now declares `yaml`, `tsx`,
  `vitest`, `@playwright/test`, `typescript` and scripts (`config:validate`,
  `rig:run`, `test`, `typecheck`); added `tsconfig.json` + `vitest.config.ts`.
  Contract audit recorded in `docs/testing-rig-contract-audit.md`.
  **Gate:** `pnpm test` 28/28; `pnpm typecheck` clean;
  `pnpm config:validate config/default.yaml` green.
- **R3 — manifest v2 + config.** `variantManifestSchema` v2 (`cohort`,
  `services{app|api|spa,db,seeder}` with `healthPath`/`hostPortEnv`/`buildArgs`,
  `seed`/`reset`, `orm`); experiment config gained `load.generatorMaxCpuPercent`
  (default 75) and duplicate-variant rejection. All 14 manifests written,
  stale `template-next.yaml` deleted, `config/default.yaml` fixed to real IDs,
  `config/smoke-matrix.yaml` added.
- **R1 — seeder + controller + `next-actions`.** New `testing-rig/seeder/` image
  (`node:22-alpine` + `pg`/`pg-copy-streams`; `seed`/`reset`/`verify` modes;
  shared `canonical-export.json`); controller state machine
  (`src/controller/`: docker/ports/tokens/plan/fixture/verify/lifecycle/artifacts/cli).
  `apps/next-actions/`: `Dockerfile` (next-standalone), `compose.yaml`,
  `.dockerignore`, `.env.example`, README; `next.config.ts` `output: standalone`
  and root-layout `force-dynamic` so `next build` needs no DB.
  **Gate:** full §3.5 gate green — `compose up` all health green; seeder
  reproduces the golden digest `11145bf8…` through the containerised Postgres
  round-trip (self-checked _and_ independently re-derived via `psql`); host HTTP
  smoke (`/` lists 5 projects, `/projects/1` lists tasks newest-first);
  `compose down -v` leaves nothing; forced-failure path still tears down.
- **R2 — pilot `spa-api` (`tanstack-express-rest`).** API image (node-api
  archetype, Node 24 type-stripping `node src/server.ts`), SPA image
  (vite-spa-static on `caddy:2-alpine` with history fallback), `VITE_API_URL`
  build arg baked from the allocated API port, CORS audited (express reflects
  the origin). **Gate:** both halves build/healthy; CRUD smoke through the API
  the SPA targets (create → id 1001 past fixture ids → update → delete → 404);
  baked API URL present in the served bundle; clean teardown.
- **R4 — remaining 12 variants dockerised** from the same archetypes.
  **Gate:** `pnpm rig:run --config config/smoke-matrix.yaml` → **14/14 variants
  ok (perf-eligible)** in one serial run; every variant seeds the golden digest
  and passes independent schema/digest verification.

### Fixes found by the gates (app/config)

- Next variants needed root-layout `export const dynamic = "force-dynamic"` and
  `output: "standalone"`; builds set a placeholder `POSTGRES_URL` (the client
  connects lazily) so no DB is needed at image-build time.
- `next-prisma` requires `pnpm prisma generate` in the build stage (generated
  client is git-ignored).
- `tanstack-flask-rest` pinned to Python **3.14** (the app relies on PEP 649
  deferred annotations; 3.13 exposes a class-scope `list` shadowing bug).
- `tanstack-fastapi-rest` runtime installs `libpq5` (`psycopg[pool]` has no
  bundled libpq).
- `tanstack-elixir-rest` Phoenix image runs `mix compile` **before**
  `mix assets.deploy` (the esbuild `phoenix-colocated` alias only exists after
  compile).

## Next steps

1. **R5 — black-box correctness suite.** Write it against `spec/contract.md`,
   then add the missing contract testids to the apps (see
   `docs/testing-rig-contract-audit.md`). Gate: passes on all 14; deliberately
   stale-UI / failed-write cases are detected as failures.
2. **R6 — render-speed suite** (Playwright, serial, cold contexts, CDP LCP).
3. **R7 — load suite + protocol adapters + telemetry** (`grafana/k6` on the
   stack network; `pg_stat_statements`; `docker stats`; generator-CPU ceiling).
4. **R8 — static inventory + reporting.** _Partly done:_ `src/reporting/` now
   collects the §6.1 inventory per run and generates the decision matrix
   (`pnpm report` → `results/<run-id>/report/{matrix.csv,matrix.md,index.html}`)
   from raw data; verified against a 14/14 smoke run. Still to do: the correctness
   /render/load columns (blank until R5–R7) and the long `default.yaml` matrix run.
5. Optionally wire browser/k6 stages into `src/controller/lifecycle.ts`, which
   already records stages and preserves artefacts on failure.
