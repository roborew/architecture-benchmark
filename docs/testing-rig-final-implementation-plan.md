# Testing rig — final implementation plan

**Status:** implementation specification for the coding agent. **Date:** 9 October 2026.
**Audience:** the agent that containerises the variants and finishes the rig.
**Relationship to other docs:** this file adds *what must be built now*, on top of
the standing decisions in [`crud-benchmark-agent-build-plan.md`](./crud-benchmark-agent-build-plan.md)
(the plan — § references below are to it), [`methodology.md`](./methodology.md)
(fairness rules, unchanged), and [`live.md`](./live.md) (repo status). Where those
documents and this one disagree about *how far the work has come*, this one is
current — it was written after a full repo audit. Nothing here re-litigates a
decision recorded in `live.md` under "Decisions worth not relitigating".

---

## 1. Where the repo actually is (audited 9 Oct 2026)

### 1.1 Variant inventory — 15 apps, three cohorts

The plan (§0) anticipated 3 Next variants + a template. The repo now has **15
variants**, in two physical shapes:

| Variant | Cohort | Shape | Transport (to verify in its manifest) |
|---|---|---|---|
| `next-actions` | `next-fullstack` | single service | Server Actions, raw SQL |
| `next-drizzle` | `next-fullstack` | single service | Server Actions, Drizzle |
| `next-prisma` | `next-fullstack` | single service | Server Actions, Prisma |
| `next-trpc` | `next-fullstack` | single service | tRPC |
| `next-orpc` | `next-fullstack` | single service | oRPC |
| `tanstack-start-react` | `tanstack-start` | single service (SSR) | server functions, direct DB |
| `tanstack-start-solid` | `tanstack-start` | single service (SSR) | server functions, direct DB |
| `tanstack-express-rest` | `spa-api` | SPA + API pair | REST |
| `tanstack-fastify-rest` | `spa-api` | SPA + API pair | REST |
| `tanstack-flask-rest` | `spa-api` | SPA + API pair | REST |
| `tanstack-fastapi-rest` | `spa-api` | SPA + API pair | REST |
| `tanstack-elixir-rest` | `spa-api` | SPA + API pair | REST (Phoenix) |
| `tanstack-express-graphql` | `spa-api` | SPA + API pair | GraphQL |
| `tanstack-express-orpc` | `spa-api` | SPA + API pair | oRPC |
| `next-template` | **excluded from DB benchmarks** | single service | in-memory, no DB |

`spa-api` pairs live as two sub-directories (e.g.
`apps/tanstack-express-rest/tanstack-rest/` SPA + `express-rest/` API). **One
variant = one Compose stack** containing both halves plus `db` and `seeder`.

`next-template` is the in-memory UI contract reference (`live.md`: the template
is the naming authority). It must not appear in DB-backed performance runs;
optionally a separately labelled no-DB baseline profile later. **14 variants
are benchmarkable.**

### 1.2 What each variant has today

- Complete source, app-local tests (unit + integration against isolated DBs),
  and their own lockfiles. Next and TanStack Start apps have `/healthz`; every
  API service exposes `/healthz` returning `{"ok":true}`.
- DB access via `POSTGRES_URL` from a local `.env` pointing at a **host
  Postgres** (e.g. `postgresql://robo@localhost:5432/architecture_next_actions`).
- Schema applied by walking up the tree to the repo-root `spec/schema.sql`
  (`src/db/spec-dir.ts` in each Next app; equivalent elsewhere). Deliberate,
  normative, fine for dev — but **no variant may bake this into a container
  image** (see §3.2).
- SPA API base URL is already build-time configurable:
  `import.meta.env.VITE_API_URL ?? "http://localhost:4000"`
  (`tanstack-*/tanstack-rest/src/api/api.ts`).
- **No `Dockerfile`, no `compose.yaml`, no `.env.example` anywhere** (verified by
  search). Nothing is containerised yet.

### 1.3 What the rig has today

Built and validated (see `docs/agent-handoff.md` M0–M2):

- `spec/` — schema, seed spec v1, profiles, golden small fixture (combined
  digest `11145bf81a9c…`, `live.md`), contract and queries docs.
- `testing-rig/src/config/` — strict Zod schemas for experiment YAML (normative
  `volume`/`capacity` scenario split) and variant manifests, effective-run-
  manifest hashing, validate CLI.
- `testing-rig/src/fixtures/generate-fixture.mjs` — dependency-free canonical
  generator, byte-identical to the golden snapshots.

Not built: controller, Playwright suites, k6, reporting (`src/controller/`
and `src/reporting/` are TODO stubs).

Stale or broken, to fix as part of this work:

- `testing-rig/manifests/template-next.yaml` points at `apps/template-next`,
  which does not exist (the app is `apps/next-template`); `config/default.yaml`
  still lists `variants: [template-next]`.
- The manifest schema hard-codes `composeServices: {app, db, seeder}` and a
  single `appHostPortEnv` — incompatible with `spa-api` pairs (two app
  services, two host ports, a build-time `VITE_API_URL`).
- `testing-rig/package.json` declares **only** `zod` and **no scripts**, yet
  `src/config/load.ts` imports `yaml` and the validate CLI runs under `tsx`.
  Add the missing deps and scripts before anything else (§7 R0).
- The rig schema has no `generatorMaxCpuPercent` equivalent, but the
  generator-saturation rejection criterion (plan §7, methodology) needs it.

---

## 2. Target — what the finished rig looks like

```text
experiment YAML ──► controller (state machine)
                       │  validates config + all variant manifests (Zod, strict)
                       │  checks host + fixture eligibility
                       │  builds canonical seeder image + every app image,
                       │    records digests, sizes, build times
                       │  for each trial, for each variant (rotated order):
                       │     compose up (unique project name, allocated ports,
                       │       resource caps, pg_stat_statements enabled)
                       │     wait /healthz; seeder: drop→schema→COPY→setval→verify digest
                       │     Playwright correctness (black-box) ─ fail ⇒ abort timing
                       │     Playwright render-speed suite (serial, cold contexts)
                       │     for each scenario: reset→seed→warm→run (k6 adapters)
                       │        + DB postcondition verify + pg_stat_statements snapshot
                       │        + docker stats sampling
                       │     try/finally teardown (stack, network, volumes)
                       │  static inventory + build metrics per variant
                       └─► results/<run-id>/: effective-config.yaml, raw JSON/CSV,
                           per-sample rows, logs, digests, decision matrix (CSV/MD/HTML)
```

Everything below exists to produce one artefact: the **decision matrix** —
`live.md`: "the primary output is a decision matrix, not benchmark numbers.
Performance figures are supporting input, labelled *indicative single-host*."

---

## 3. Work package A — containerise every variant (in isolation)

### 3.1 Canonical stack topology (identical for every variant)

Each variant gets a `compose.yaml` **at its root** (for `spa-api` pairs: at
`apps/tanstack-<x>/`, orchestrating both sub-directories). Services:

| Service | Image / build | Notes |
|---|---|---|
| `db` | pinned `postgres:17-alpine` (record digest) | `POSTGRES_USER=bench`, `POSTGRES_PASSWORD=bench`, `POSTGRES_DB=bench`; command adds `-c shared_preload_libraries=pg_stat_statements`; **no published host port** (rig reaches it via `docker compose exec`); same resource caps for every variant |
| `seeder` | `bench-seeder` image, rig-owned (§3.2) | `run --rm` one-shot; profiles: `seed`, `reset`, `verify` |
| `app` (or `api` + `spa`) | variant's own `Dockerfile`(s) | production mode only; `POSTGRES_URL=postgresql://bench:bench@db:5432/bench` passed at runtime |

Resource caps come from experiment YAML `resources:` and are applied as
`deploy.resources.limits` (`cpus`, `memory`) on **app and db** services
identically across variants. The seeder runs in the setup phase only and is
exempt from caps (record that it is).

### 3.2 Canonical seeder image (the plan §4 blessing, made concrete)

The plan explicitly allows "an identical canonical fixture loader via a seeder
service in each app stack … instead of a per-app generator for measured trials".
This is the chosen route — it also solves the `spec-dir.ts` coupling: **no app
image ever contains or walks to `spec/`**.

- Build context: `testing-rig/seeder/` (new directory): `Dockerfile`
  (`node:22-alpine` + `pg` npm package), a copy of `generate-fixture.mjs`, a
  copy of `spec/schema.sql`, and a `seed.ts` entry that:
  1. drops/recreates schema (`reset` mode) or applies `spec/schema.sql`;
  2. generates the requested profile's CSVs **in-container** (the generator is
     pure-arithmetic and dependency-free — medium/large need no pre-baked CSVs);
  3. `COPY`-loads them, then `setval`s all four identity sequences past the
     fixture IDs (plan §2);
  4. exports back out and hashes — **must reproduce the golden digest** for
     `small` (`11145bf8…`); prints counts + digest to stdout as JSON.
- The controller re-verifies independently via
  `docker compose exec db psql … COPY (SELECT …) TO STDOUT | sha256sum` plus
  `pg_indexes`/constraint checks (plan §2: "check `pg_indexes`, constraints and
  column definitions, not merely whether an ORM migration reports success").
- Apps keep their existing `db:migrate`/`db:seed` for host-Postgres dev use.
  The app image does not need them at all: schema and data arrive via the
  seeder on the stack network.

### 3.3 Dockerfile archetypes (six, reused across variants)

Write each archetype once, then instantiate per variant. All are multi-stage,
production mode, non-root, no dev dependencies in the final image, and **no
build context outside the variant directory** (the copy-out rule, plan §1).

1. **next-standalone** — `next build` with `output: "standalone"`; run
   `node .next/standalone/server.js`. Env: `POSTGRES_URL`, `APP_PORT`,
   `NODE_ENV=production`. Applies to the 5 `next-fullstack` variants.
2. **node-api** — Express 5 / Fastify 5: `tsc` build → `node dist/server.js`
   (ESM-clean: the APIs already run `node src/server.ts` directly).
3. **python-api** — FastAPI: `uvicorn app.main:create_app --factory` (check
   workers setting; record it). Flask: production WSGI server (gunicorn);
   record the choice in the manifest — it is part of the architecture.
4. **phoenix** — `MIX_ENV=prod mix deps.get + compile + phx.digest`,
   `mix phx.server`. Ecto repo connects via `POSTGRES_URL`-equivalent env.
5. **tanstack-start** — `vite build` → `.output` node server; run it
   (`start-react`, `start-solid`).
6. **vite-spa-static** — `vite build` → static assets served by **one pinned
   static-server image shared by all 7 SPA variants** (`caddy:2-alpine` or
   `nginx:1.27-alpine`, with SPA history-mode fallback to `index.html`).
   Serving infrastructure is a constant across `spa-api` variants, not a
   variable.

### 3.4 SPA/API wiring (per `spa-api` variant)

- The rig allocates host ports once per (run, variant) — stable across that
  variant's trials so image digests stay comparable — and passes the API port
  into the SPA image **build** as `VITE_API_URL=http://localhost:<api-port>`
  (the SPA code already supports it). The SPA port and API port are both
  published; `POSTGRES_URL` is not.
- **Audit each API's CORS config.** Dev runs cross-origin already
  (vite `:3000` → API `:4000`), so CORS exists, but if any API hard-codes the
  allowed origin, make it env-configurable (`CORS_ORIGIN`, defaulting to the
  current dev value) and have the rig pass `http://localhost:<spa-port>`.
  This is one of the few app-side code changes this plan requires.

### 3.5 Per-variant deliverables checklist + gate

Per variant: `compose.yaml` (stack root), Dockerfile(s), `.env.example`
(`POSTGRES_URL`, ports, `CORS_ORIGIN` where applicable), README "Run in Docker"
section. Manifest entry (§4). **Gate per variant:** on an idle Docker host —

```text
docker compose -p bench-<id> up -d --build
  → all /healthz (or / for the static SPA) green
  → seeder seed → digest matches golden (small)
  → CRUD smoke over HTTP from the host
  → docker compose down -v leaves nothing behind
```

Run the pilot pair first (§7 R1/R2), then the remaining twelve.

---

## 4. Work package B — manifest schema v2 + config fixes

Replace `variantManifestSchema` (keep `.strict()`, keep command-arrays-as-
design-shape semantics — the controller resolves paths/ports itself and never
executes a shell string from YAML). New shape (illustrative):

```yaml
schemaVersion: 2
id: tanstack-express-rest
cohort: spa-api            # next-fullstack | spa-api | tanstack-start
appDirectory: ../apps/tanstack-express-rest
composeFile: ../apps/tanstack-express-rest/compose.yaml
projectPrefix: bench-tanstack-express-rest
services:
  api:   { composeService: api,  kind: api, healthPath: /healthz, hostPortEnv: API_PORT }
  spa:   { composeService: spa,  kind: spa, healthPath: /,
           hostPortEnv: SPA_PORT, buildArgs: { VITE_API_URL: "http://localhost:{{API_PORT}}" } }
  db:    { composeService: db,   kind: db }
  seeder:{ composeService: seeder, kind: seeder }
seed:  { command: [compose, run, --rm, seeder, seed] }
reset: { command: [compose, run, --rm, seeder, reset] }
capabilities: [list, detail, create, update, delete, create-with-comment]
readMode: spa-fetch-rest
mutationMode: rest
orm: none
```

- `{{API_PORT}}`-style tokens are resolved by the controller **after** port
  allocation, before `compose build`.
- Single-service variants have one `kind: app` entry (health `/healthz`,
  `hostPortEnv: APP_PORT`) — the current `next-actions` shape, generalised.
- Add `cohort` and `orm` fields; reports group by cohort and label
  cross-cohort comparisons as indicative.
- Regenerate `manifests/` for all 14 variants; delete the stale
  `template-next.yaml`; update `config/default.yaml` `variants:` to real IDs.
- Add `load.generatorMaxCpuPercent` (default 75) to the experiment schema —
  required by the generator-saturation rejection criterion.
- Keep `network.appToApiAddedRttMs: 0` enforced for now (phase-1 rule); for
  `spa-api` stacks the SPA→API hop is *in-stack reality*, not synthetic
  latency, and is simply part of what that cohort measures.

---

## 5. Work package C — controller lifecycle

Implement in `testing-rig/src/controller/` as an explicit state machine (plan
§6 is the normative diagram). Key mechanics, concretised for this repo:

- **Compose via `execFile`, never a shell string.** Project name
  `bench-<variantId>-<runId>`; a run manifest of allocated ports is written
  before `up` and embedded in results.
- **Port allocation:** bind ephemeral listeners to find free host ports once
  per (run, variant); export as the manifest's `hostPortEnv` names.
- **Readiness:** poll each service's `healthPath` on its published host port;
  the static SPA is ready on any 200 from `/`.
- **Seeding/verification:** seeder run (§3.2), then independent controller
  verification through `docker compose exec -T db psql` — schema/index check,
  row counts, export hash. Digest mismatch ⇒ reject the trial before timing.
- **Eligibility pre-check** (plan §3): before any timed run, confirm the
  fixture provides enough distinct eligible update/delete/create-with-comment
  targets per the seed-spec ID bands; reject impossible plans up front.
- **Between phases:** `reset.method: database-recreate` via the seeder (no app
  restarts). Warmups identical to measured runs and discarded.
- **Teardown:** `try/finally` — `docker compose down -v --remove-orphans` for
  the project; verify no leftover networks/volumes; preserve logs and
  failure artefacts under `results/<run-id>/` on every exit path.
- **Run metadata:** effective-config hash (already implemented), image
  digests + sizes, Git revision, pinned Playwright/k6/Postgres versions.

---

## 6. Work package D — the measurement model (the decision matrix)

This is the section that answers *"which architecture is best, tangibly"*.
Every metric lands as a column in the matrix; raw data is always preserved.

### 6.1 Static & complexity inventory (per variant, collected once per run)

**Counting rules matter** — an initial survey showed e.g. `next-actions` at
~292k LOC across 338 files, because generated test-data files are checked in.
The inventory must split:

- **In:** app-authored source (`src/`, server code, db code, `scripts/`),
  counted separately from tests (`tests/`, `*.{test,integration,e2e}.*`), and
  from infrastructure (Dockerfiles, compose, configs).
- **Out:** `node_modules`, build output (`.next/`, `.output/`, `dist/`),
  lockfiles, generated code (ORM clients, route-tree codegen, generated
  data files), fixtures, reports.
- Report: source file count, LOC, bytes (by language), test file count + LOC,
  direct dependency count (from `package.json`/`pyproject.toml`/`mix.exs`),
  languages/runtimes count, service count, image count, infra-config LOC.

### 6.2 Build & deploy footprint (per variant, per run)

- Per-image size and total stack size (`docker image inspect` / `docker system`).
- Cold build time (`--no-cache`) and cached build time — recorded, labelled;
  build time is machine-relative, keep it in the "indicative" tier.
- Cold start: `compose up` → all health green (setup-phase metric).
- Seed + verify wall-clock per fixture profile (setup-phase metric).

### 6.3 Correctness gate (per variant, per trial — pass/fail prerequisite)

The shared black-box Playwright suite (§7/WP-E) against `BENCH_BASE_URL`, plus
DB postcondition checks. **A failure invalidates that variant's performance
numbers for the trial** (plan §5). The matrix shows the gate result; failed
variants show no perf columns for that trial.

### 6.4 Render speed (browser, serial, per variant)

Cold browser context per sample (context ≠ cold app — apps stay warm, plan
§5), fixed pinned Chromium, fixed viewport, warmup samples discarded,
`measuredSamples` from config, runs serial per variant.

- **Navigation metrics** on data-bearing pages (dashboard/home — the richest
  aggregate read; project task list; task detail): TTFB, FCP, LCP (CDP), plus
  **first-useful-data** = first data row/card visible (Playwright locator) —
  the "speed to first render" the user actually perceives. For `spa-api`
  variants this includes SPA boot + API round trip; that difference *is* the
  architecture. Label it.
- **Interaction metrics:** click-to-visible-committed for create, update,
  delete, create-with-comment — complete only when the persisted result is
  visible (plan §5; never labelled INP). Verify the DB postcondition too.
- Report per-op p50/p95 (p99 only where samples justify, plan §6) and
  sample/trial spread. Keep raw per-sample rows.

### 6.5 Load behaviour (per variant × scenario)

- **Volume scenarios** (exact successful counts, disjoint target pools leased
  in setup): offered vs achieved, per-op p50/p95/p99, wall time, error counts,
  verified postconditions (plan §4).
- **Capacity ladders** (weights, rate steps): achieved rate per step,
  saturation point (first step missing target), error rate, latency drift
  (plan §4).
- **Protocol adapters per transport** — REST/GraphQL (trivial k6), tRPC, oRPC,
  Next Server Actions, TanStack server functions. Each adapter must be
  **validated by capturing a real browser request** (Playwright route/HAR),
  replaying it, and verifying the DB postcondition, before any
  mutation-capacity claim for that transport (plan §5/§7). Until validated:
  read-only capacity for that variant + Playwright CRUD timing, labelled.
- **Telemetry during scenarios:** container CPU/mem sampled (`docker stats`
  stream) for app + db; `pg_stat_statements` snapshot per phase (statement
  counts, mean/total time by family); generator CPU monitored against
  `generatorMaxCpuPercent` — saturation rejects the trial.
- Derived: CPU-seconds and MB-seconds per 100 successful ops; ops/s at
  saturation; DB size on disk after seed (sanity: near-identical across
  variants — a mismatch flags a fixture or schema drift).

### 6.6 The matrix itself

- One row per (variant × trial), grouped by cohort; columns grouped 6.1–6.5.
- **No composite "best" score by default.** If the user configures weights,
  render a clearly labelled weighted view alongside, never instead of, the
  raw columns (`live.md`: decision matrix first).
- Every value carries run-manifest hash, trial ID, and image digests.
- Outputs: CSV + Markdown table + HTML (self-contained) under
  `results/<run-id>/report/`, generated only from raw JSON/CSV.

---

## 7. Implementation order and gates

Each step has a hard gate; do not start the next until it passes. Write the
failing test first where a test applies (plan §8 work instructions).

- **R0 — housekeeping (no Docker yet).** Fix `testing-rig/package.json` (deps:
  `yaml`, `tsx`; dev: `vitest`, `@playwright/test`; scripts: `test`,
  `config:validate`, `rig:run`, …). Refresh `spec/contract.md` against the
  real routes/selectors if stale (`live.md` flags it); confirm the
  black-box suite's selectors are contract-defined and present in apps.
  **Gate:** rig tests green; contract audit recorded.
- **R1 — seeder + controller skeleton + pilot single-service
  (`next-actions`).** Seeder image (§3.2), controller state machine (§5) far
  enough to boot/reset/seed/verify/teardown. **Gate:** full §3.5 gate on
  `next-actions` with `small` fixture; golden digest reproduced through the
  containerised Postgres round-trip; forced-failure path still tears down
  cleanly.
- **R2 — pilot `spa-api` pair (`tanstack-express-rest`).** Static-server
  archetype, `VITE_API_URL` build arg, CORS audit. **Gate:** §3.5 gate on both
  halves; CRUD smoke through the SPA's published port.
- **R3 — manifest v2 + all 14 manifests + config fix.** **Gate:**
  `config:validate` green for every manifest; controller boots, seed-verifies
  and tears down every stack (serial).
- **R4 — dockerise the remaining 12 variants** from the archetypes.
  **Gate:** per-variant §3.5; record image digests/sizes/build times (first
  matrix columns populated).
- **R5 — black-box correctness suite + DB verifier (plan M3).** **Gate:**
  suite passes on all 14; deliberately-stale-UI and failed-write tests are
  detected as failures.
- **R6 — render-speed suite.** **Gate:** repeated-run variance measured and
  documented (plan M3 baseline variance).
- **R7 — load suite + adapters + telemetry (plan M5).** **Gate:** per plan M5
  — effective config records exact fixture size, actual success counts,
  attempted vs achieved throughput, failure reasons, run-to-run spread;
  adapters validated per transport before mutation-capacity claims.
- **R8 — inventory + reporting + the first full matrix run.** Rotated
  trials, small + medium fixtures, all cohorts. **Gate:** decision matrix
  generated from raw data for all 14 variants with zero correctness failures
  and no fairness rejections unexplained.

### Host prerequisites (carry-over from `live.md`)

- Docker Desktop disk space previously caused `initdb` "No space left on
  device" — prune before Compose work and verify free space first.
- Idle host, one stack at a time; results labelled *indicative single-host*
  (macOS Docker Desktop) per methodology; serious saturation numbers need a
  separate load-generator machine later.

---

## 8. Open decisions (confirm before R1)

1. **Postgres pin** — propose `postgres:17-alpine`, exact digest recorded.
2. **k6 execution** — propose the `grafana/k6` image attached to the stack
   network (targets service names; no host-port dependency), CPU monitored
   via docker stats. Native k6 is the fallback if containerised-generator
   overhead proves measurable.
3. **First full-run budget** — trials/sample counts from `config/default.yaml`
   (5 trials × 30 samples × 2 scenarios × 14 variants is a long run; a
   reduced `smoke-matrix.yaml` for the first pass is worth defining).
4. **`next-template`** — exclude from DB runs (default), or add a labelled
   no-DB baseline profile.
5. **Python API servers** — uvicorn workers for FastAPI, gunicorn for Flask:
   worker counts are architecture choices; record per manifest.
6. **`spec/queries.md`** — still partial per `live.md`; complete it when the
   correctness suite is written (R5), since the suite asserts those shapes.
