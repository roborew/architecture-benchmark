# CRUD architecture benchmark — coding-agent build plan

**Status:** implementation specification. **Date:** 27 September 2026. **Audience:** coding agent implementing the repository. **Supersedes:** earlier benchmark plans wherever they implied a shared runtime workspace or left database fixtures unspecified.

## 0. Objective and non-negotiable decisions

Build a repository containing (a) an **independently runnable reference/template app**, (b) three independently runnable Next.js variants, and (c) one separate testing rig. Every app owns its own dependency manifest/lockfile, Dockerfile, Compose file, Postgres service/volume, SQL schema/migrations, local seed/reset implementation, README, and local tests. It must be possible to copy any app directory out of the repo and run it on its own. No production or test imports between apps, or from the rig into an app. No root dependency workspace linking apps.

A **root specification** defines the canonical behavior, SQL schema and deterministic data algorithm. The template app is an executable example of that specification, not a runtime dependency. The other apps may use copied local schema/seed definitions but must match the versioned spec. The rig validates them, selects an app by manifest, runs that app's own Compose stack, controls its data setup through an explicit adapter, executes one external black-box Playwright suite, collects measurements, and destroys the stack. Apps never compute their own performance scores.

**Phase-1 cohort:** `next-actions`, `next-trpc`, `next-rest`; all use the same Postgres schema and Drizzle, and Server Component database reads for initial list/detail; mutation mechanism differs. `template-next` is a functional, independently testable reference app (it may use Server Actions), but **do not report it as an independent architecture** or reuse it as a shared imported package. Later cohorts can vary read location, ORM, GraphQL, external APIs, or a React SPA, each explicitly labelled.

The rig supports YAML-configured fixture scale, operation counts, read/write mix, concurrency, arrival rate, latency profile, warmup, and trials. A requested `100` versus `1000` updates means **100 versus 1000 successful state changes against predetermined distinct records**, not 100/1000 attempts that might silently target already-deleted or stale rows. Record offered and achieved counts separately. A user-facing mutation timing is complete only when the persisted result is visible; a k6 HTTP completion is a different metric and must be labelled as such.

## 1. Repository structure

```text
architecture-bench/
  README.md
  spec/
    contract.md                 # exact screens, CRUD semantics, selectors and outcomes
    schema.sql                  # authoritative PostgreSQL DDL
    seed-spec.md                # deterministic generation algorithm and version
    seed-profiles.yaml          # canonical small/medium/large fixture profiles
    queries.md                  # exact result shape, filters, pagination, SQL expectations
    snapshots/                 # small golden fixture CSV + expected checksums
  apps/
    template-next/
    next-actions/
    next-trpc/
    next-rest/
  testing-rig/
    package.json
    pnpm-lock.yaml
    manifests/*.yaml
    config/default.yaml
    config/examples/*.yaml
    src/config/                # load/validate YAML and resolve effective config
    src/controller/            # lifecycle, reset, setup, verification
    src/fixtures/              # independent conformance validator and fixtures
    playwright/correctness/
    playwright/performance/
    k6/
    src/reporting/
    results/                   # gitignored; raw files and reports
  docs/
    methodology.md
    agent-handoff.md
```

Each `apps/<app>/` owns at minimum: `package.json`, `pnpm-lock.yaml`, `Dockerfile`, `compose.yaml`, `.env.example`, `README.md`, `db/schema.sql`, `db/migrations/`, `db/seed.ts` or `db/seed.py`, `db/reset` entry point, `src/`, and `tests/`. Next apps reserve `src/app/` for route entries; put UI under `src/components/` and DB/domain/transport under `src/server/`. Each app may adapt the shared spec into its own implementation language; it does not import `spec/` at runtime.

**Copy-out gate:** as an automated acceptance check, copy each app folder to a temporary directory outside the monorepo (and outside any root `node_modules`), then install with its own lockfile, build, run its own Compose file, reset/seed, exercise CRUD, run local tests, and destroy it. If a Docker build depends on `../../spec` or another app, this gate fails. Schema and seed specifications therefore have checked-in local copies or app-local equivalent implementations. The rig checks their compatibility against canonical artifacts.

## 2. Canonical database design

Use a moderately normalized task-board domain. The four tables below keep basic CRUD cheap while supporting joins, fan-out, referential integrity, indexed lists, and a transactional multi-row write. Do not add tenants, authentication, tags, search services, or audit tables in phase 1. Keep `status` as constrained text; do not add an artificial status lookup join.

### DDL requirements

The authoritative `spec/schema.sql` should implement equivalent PostgreSQL DDL to the following **normative baseline**. Use `BIGINT` fixture IDs to make deterministic seeding and partitioned write ranges easy. App-generated new task/comment IDs must never collide with seeded IDs: use identity sequences and advance them after explicit-ID bulk seed inserts. Store all timestamps as UTC `timestamptz`. Do not rely on nondeterministic default timestamps in generated fixtures.

```sql
CREATE TABLE users (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  display_name text NOT NULL
);

CREATE TABLE projects (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE tasks (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  assignee_id bigint REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE comments (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL
);

CREATE INDEX tasks_project_created_id_idx
  ON tasks (project_id, created_at DESC, id DESC);
CREATE INDEX tasks_project_status_created_id_idx
  ON tasks (project_id, status, created_at DESC, id DESC);
CREATE INDEX comments_task_created_id_idx
  ON comments (task_id, created_at DESC, id DESC);
CREATE INDEX tasks_assignee_id_idx ON tasks (assignee_id);
CREATE INDEX comments_author_id_idx ON comments (author_id);
```

Use `UNIQUE`/extra indexes only when a documented query needs them. Index costs are part of the workload; all apps must use the same indexes. Check `pg_indexes`, constraints and column definitions, not merely whether an ORM migration reports success. During seed, load explicit IDs and then advance all four identity sequences using `setval`/equivalent so live inserts allocate fresh IDs. Define behavior for deleting a task with comments (comments cascade; the app reports the task gone) and for changing assignee (nullable user relation) exactly once in `spec/contract.md`.

### Required read/write paths

| Operation | Data shape and DB consequence | Primary benchmark purpose |
|---|---|---|
| List project tasks | 25 tasks in `(created_at DESC, id DESC)` order; show assignee names and status; optional status filter | Indexed pagination and bounded relation loading |
| Task detail | One task, project, assignee, and 10 most recent comments with author names | Multiple related reads / joins |
| Create task | Insert task for existing project; return persisted ID and show task | Single-row write and refresh |
| Update task | Change title/status/assignee, explicitly set `updated_at`; show committed result | Indexed lookup and write |
| Delete task | Delete selected task and its comments under documented cascade; show absence | Referential integrity and refresh |
| Create with initial comment | Atomically create a task and a comment, or roll back both | Transaction and multi-row write |

Implement **keyset pagination** for paginated list flows with `(created_at, id)` cursor, a stable tiebreaker, and consistent page size. The initial list can use the first page; do not force every benchmark run to page deeply. Queries must limit both returned rows and nested comments. Record SQL statement count and inspect plans for diagnostic purposes. Do not force three architectures to call identical internal functions; do require identical result semantics and indexed data access.

## 3. Seed model and scale

Distinguish these four axes in config and reports:

- **Database scale:** rows present before a trial: projects, users, tasks, comments per task/distribution.
- **Operation volume:** how many creates, updates, deletes, and reads the suite must complete.
- **Concurrency or arrival:** how quickly operations are offered, distinct from total count.
- **Access locality:** working-set size / how many different records a test touches; distinguishes hot repeated reads from broad scans.

Do not represent all of them with one ambiguous `records: 1000` property.

### Deterministic seed algorithm (v1)

Define a versioned, portable algorithm or a canonical set of generated CSV files. **Recommended for v1:** the rig generates canonical CSV artifacts for each configured fixture profile; each standalone app provides its own app-local generator for independent use that produces identical CSV/checksums for the same profile. The rig loads CSV through Postgres `COPY` or a dedicated one-shot seeder container *inside the selected Compose stack*; it does **not** alter an app's runtime imports. App-local `seed` also uses app-local files/logic and must match a small golden fixture. For large profiles, generate the files once per profile, record SHA-256 hashes, and restore a baseline database snapshot per trial where feasible. Avoid seeding through the UI in measured trials.

Parameters: seed version and integer seed, project/user/task counts, comments distribution, task status percentages, title and body length distributions, UTC base timestamp, and hot-set fraction. For v1, prefer simple arithmetic ID assignment and a specified deterministic pseudorandom generator or a fixed CSV generator implementation; tests verify **exact** SHA-256 of exported canonical rows for the small profile. Allocate task IDs `1..N`; e.g. project for task `i` is `1 + ((i-1) mod project_count)`, assignee is `1 + ((i-1) mod user_count)`, status rotates across documented ratios, and timestamps derive from a fixed base UTC time plus deterministic offsets. Comments use deterministic task assignment and own monotonically allocated IDs. Do not depend on database `random()`, wall-clock time, unordered row scans, or framework Faker defaults.

Proposed starting fixture profiles (adjust only by changing versioned YAML):

| Profile | Projects | Users | Tasks | Comments | Intended use |
|---|---:|---:|---:|---:|---|
| `small` | 5 | 20 | 1,000 | 1,000 | Local correctness and fast smoke |
| `medium` | 50 | 200 | 50,000 | 100,000 | Primary architecture comparison |
| `large` | 200 | 1,000 | 500,000 | 1,000,000 | Scale/DB sensitivity experiment |

These are *example settings*, not mandatory benchmark targets. Record actual rows and bytes on disk. The fixed dataset must include eligible tasks with comments for deletes, tasks in every status and project, and enough distinct task IDs for the requested update/delete volume. Reject impossible plans **before starting** a timed run.

### Data namespaces and workload pools

Deterministically designate fixture task ID ranges or a generated eligibility manifest for: read-only samples, update-only samples, delete-only samples, and tasks used to test initial-comment transactions. Do not have simultaneous workers mutate the same row unless running a separately labelled contention profile. Creates use unique titles/keys per run/worker and capture the returned ID for cleanup and assertion. Ensure that a target selected for update is not also scheduled for delete in the same trial. For `1000` deletes, seed at least `1000` distinct eligible tasks, with room for other flows. Perform an identical reset between correctness, browser measurement, and load phases.

Operations should be distributed over a documented `workingSetFraction` or absolute pool size. A small hot set and a wide working set produce different cache behaviors; publish both as separate profiles rather than averaging them together. Do not call an update successful because a request returned 200: check the intended row and value. For write-load trials, allocate disjoint task IDs by worker/VU or atomically lease IDs in a **setup phase** outside the measurement, not through a contested coordinator during the timed path.

## 4. Configuration and manifest files

### Rig configuration: one YAML per experiment

Implement YAML parsing plus JSON Schema (or Zod) validation; reject unknown keys, impossible counts, invalid mixes, and incompatible architecture capabilities. The controller resolves defaults and profiles to an **effective immutable run manifest**, saves it before running, and embeds its hash into results. CLI overrides may change config, but the resolved output must preserve them. No app should need to understand the rig YAML.

```yaml
schemaVersion: 1
name: medium-crud-volume-100
variants: [next-actions, next-trpc, next-rest]
trials: 5
variantOrder: rotate

fixture:
  seedVersion: 1
  seed: 42
  projectCount: 50
  userCount: 200
  taskCount: 50000
  commentCount: 100000
  baseTimestamp: '2025-01-01T00:00:00Z'
  statusPercent: { todo: 50, doing: 30, done: 20 }
  workingSetFraction: 0.20

reset:
  betweenPhases: true
  betweenTrials: true
  method: database-recreate  # no app restart except explicit cold-start profile

browser:
  engine: chromium
  workers: 1
  warmupSamples: 10
  measuredSamples: 30
  viewport: { width: 1365, height: 768 }
  cacheProfile: cold-browser-context
  prefetch: disabled
  operations: [list, detail, create, update, delete]

workload:
  profile: mixed-crud
  operations: { list: 400, detail: 200, create: 100, update: 100, delete: 100 }
  selection: disjoint
  arrival:
    mode: constant-rate
    ratesPerSecond: [5, 10, 20, 40]
    durationPerStepSeconds: 180
  generatorMaxCpuPercent: 75

network:
  browserToAppAddedRttMs: 0
  appToApiAddedRttMs: 0

resources:
  appCpus: 2
  appMemoryMb: 2048
  dbCpus: 2
  dbMemoryMb: 2048

report:
  keepRawSamples: true
  outputFormats: [json, csv, html]
```

**Important semantics:** operation counts above describe the desired *total completed operation allocation for a volume-limited run*; the constant-rate step ladder describes *rate-limited capacity experiments*. Do **not** execute the entire `{list: 400, ...}` total anew at every step and pretend it is one total; define two explicit scenario types in the parser:

- `volume`: exact requested successful counts (or report shortfall after capped attempts), fixed concurrency/think time, bounded duration. Use it to compare **100 versus 1000 mutations**.
- `capacity`: rate and duration per step, operation **weights** (not fixed totals); count actual successes/errors and report achieved mix. Use it to find saturation.

The YAML above illustrates fields from both: the implementation must **split it into separate `scenarios:` entries** with `kind: volume` and `kind: capacity` before M5 is accepted. This requirement prevents ambiguous semantics. The following is the normative workload shape to implement instead of a single combined `workload:` mapping:

```yaml
scenarios:
  - id: volume-100-writes
    kind: volume
    counts: { list: 400, detail: 200, create: 100, update: 100, delete: 100 }
    concurrency: 5
    maxAttemptsPerOperation: 110
    maxDurationSeconds: 600
    resetBefore: true
  - id: capacity-mixed
    kind: capacity
    weights: { list: 40, detail: 20, create: 15, update: 15, delete: 10 }
    ratesPerSecond: [5, 10, 20, 40]
    durationPerStepSeconds: 180
    preallocatedVUs: 50
    maxVUs: 200
    resetBefore: true
```

The actual `config/default.yaml` must use only the **normative `scenarios` shape**, not the illustrative `workload` shorthand above. A `volume-1000-writes.yaml` can increase create/update/delete counts to 1000 each, enlarge eligible pools, and keep other settings constant. Report the number of attempts, successes, failures, and verified postconditions. For rate tests, report offered arrivals, achieved arrivals, dropped iterations, achieved operation mix, latency and errors; do not assert an exact mutation count from weighted selection.

### Variant manifest

```yaml
schemaVersion: 1
id: next-actions
appDirectory: ../apps/next-actions
composeFile: ../apps/next-actions/compose.yaml
projectPrefix: bench-next-actions
healthPath: /healthz
appHostPortEnv: APP_PORT
composeServices: { app: app, db: db, seeder: seeder }
seedCommand: [docker, compose, run, --rm, seeder, seed]
resetCommand: [docker, compose, run, --rm, seeder, reset]
capabilities: [list, detail, create, update, delete, create-with-comment]
readMode: rsc-direct-db
mutationMode: server-action
```

Treat command arrays as a *design shape*: resolve app-relative paths and the unique Compose project name in controller code; never execute an unvalidated shell string from a YAML file. It is acceptable for the rig to run an identical **canonical fixture loader** via a seeder service in each app stack instead of a per-app generator for measured trials, but each app must retain its own local seed/reset path for standalone operation. Verify the inserted data/checksum rather than trusting a successful exit code. Avoid global port collisions by allocating and passing `APP_PORT`; no Compose stack needs a hard-coded rig port to work alone.

## 5. Local app tests versus rig tests

### Within each standalone app

- Unit tests: domain validation, cursor parsing, deterministic seed mapping, status behavior.
- Integration tests against its **own isolated test database**: migrations/schema, FK and cascade behavior, Drizzle repository list/detail shape, transaction rollback, create/update/delete, sequence advancement after seed.
- Transport tests: one or more Server Action/tRPC/REST mutation and read endpoints as appropriate, plus error cases. Test the actual path rather than only testing a repository function.
- Browser smoke if useful: local CRUD works from the app directory. The full comparative Playwright suite still lives only in the rig.
- Standalone smoke: `docker compose up --build -d`, local reset/seed, browser or HTTP checks, `pnpm test`, build, teardown. Ensure the app does not rely on any sibling directory.

### Within the external rig

- One Playwright **correctness** suite against a supplied `BENCH_BASE_URL`. Check visible list/detail, create/update/delete and create-with-comment, validation, reload persistence, and stable pagination. Verify DB postconditions independently through the selected stack's Postgres connection or a dedicated verifier sidecar. No implementation-specific action selectors.
- One serial Playwright **browser performance** suite with fixed browser binary, viewport, cache and prefetch profiles. Capture first useful-data render and click-to-visible-committed outcome; also record TTFB/FCP/LCP where available. A cold browser context does **not** imply a cold app process. Do not label a click-to-visible measurement INP.
- Capacity/volume suite using validated protocol adapters. Keep scripts outside apps, but inspect actual browser requests and verify that Action, tRPC and REST adapters exercise the real mutation paths and same postconditions. Until an Action adapter is validated, run read-only k6 capacity plus Playwright CRUD timing; do not substitute a REST endpoint for Server Actions. A browser-concurrency profile can be separately labelled if needed.
- Run correctness first. A failure invalidates the corresponding performance result. Measurement runs are serial per variant; correctness suites may later parallelize only with disjoint fixtures.

## 6. Controller lifecycle and artifacts

Implement the orchestrator as an explicit state machine with unique run/trial IDs:

```text
validate experiment YAML + all selected variant manifests
  → check host and fixture eligibility (e.g. 1000 distinct delete targets)
  → build production images before timed work, record digests/versions
  → for each trial and each variant in rotated order:
       start that app's own Compose stack under a unique project name
       wait for app/DB readiness; record CPU/memory caps and network topology
       reset DB; load canonical fixture profile; verify schema and row hashes
       run app-independent Playwright correctness; abort timing if it fails
       reset DB; warm identically; collect browser metrics
       for each configured scenario:
          reset DB when requested; load same fixtures; assign disjoint IDs
          warm identically; run scenario; verify DB postconditions
          collect container/DB/server metrics and raw samples
       preserve logs and failures; stop stack and destroy trial volumes
  → generate immutable effective config, raw JSON/CSV, and HTML report
```

Use `try/finally` cleanup; do not leak volumes/networks on failure. Run experiments on an otherwise idle Linux host, one app stack at a time; for serious saturation results place the load generator on a separate machine. On one host, separate Playwright timing runs from k6, monitor generator CPU, and label results as relative single-host measurements. Sysbox can be used for development isolation but should not vary across timed variants.

Output per run should include `effective-config.yaml`, fixture CSV hashes and schema checks, app/DB image digests, Git revision, pinned runtime/browser versions, app logs, Playwright failures and raw timing rows, k6 raw/summary output, resource samples, `pg_stat_statements` snapshots, and generated report. Report per-op p50/p95/p99 where sample sizes justify it, trial spread, success/error/timeout counts, request count, SQL counts, and successful operations per second. A generated report is a reproducible view over raw data, not the only copy of results.

## 7. Fairness checks and rejection criteria

Reject a trial if any of the following is true: schema/fixture checksum mismatch, missing or extra required UI data, persistence check fails, unexpected retries, insufficient unique eligible write targets, missing measurement samples, wrong build mode, unaccounted cache/prefetch difference, resource throttling outside defined caps, load-generator saturation, or Action mutation load adapter not validated while claiming an Action mutation-capacity comparison.

Compare *two kinds of scale* separately: (a) DB size fixed while number of operations rises from 100 to 1000, which tests workload volume/resource buildup; (b) operation count and mix fixed while the DB grows from 1,000 to 50,000 to 500,000 tasks, which tests database-size sensitivity. Reset between trials; for accumulation/soak tests where data is intentionally not reset during the run, report the changing row count and resulting database size as part of the independent variable. Do not conflate '1000 writes' with '1000 rows seeded.'

Keep DB network topology and resource limits equivalent in phase 1. Add browser-to-app and app-to-external-backend latency as separate profiles when those backends exist. In the first cohort there is no separate backend service, so `appToApiAddedRttMs` must be rejected or explicitly marked inapplicable; do not pretend this adds latency to an in-process tRPC handler.

## 8. Agent execution plan and acceptance gates

**M0 — Specification first.** Produce `spec/schema.sql`, behavior/queries docs, seed algorithm, profile YAML, and small golden fixture plus hashes. Add tests that apply the DDL to an empty DB and validate identity sequences, FK/cascade, sorted pagination, and exact fixture hash. **Gate:** the same seed parameters produce byte-identical exported canonical rows after two fresh resets.

**M1 — Standalone template.** Build `apps/template-next` as a complete task app, with local Postgres/Compose, package and lockfile, schema and seed implementation, tests, README, and production build. **Gate:** automated copy-out test proves it runs with no repo-relative imports; SQL and seed match M0.

**M2 — Rig foundation.** Build `testing-rig` as an independent pnpm project. Implement YAML validation with distinct `volume`/`capacity` scenarios, manifest loader, Compose project/port management, reset/seed/verification, run metadata, and cleanup. **Gate:** it starts the copied template app, loads small and medium fixtures, checks hashes, handles forced failure, and cleans up without touching other stacks.

**M3 — Shared black-box E2E.** Build external Playwright correctness and serial browser timing suites. Add DB postcondition verifier, fixture partitioning, raw per-sample output, and failure traces. **Gate:** same suite runs on template app; deliberately stale UI and failed write tests are detected. Baseline timing variance documented across repeated runs.

**M4 — First benchmark apps.** Build each Next variant with independent package/lockfile, Compose DB, seed/reset, README and app-local tests. Match spec but implement Action, tRPC and REST transports genuinely. **Gate:** each passes copy-out, app-local, canonical DB/seed, and *unchanged* rig correctness suites. Initial read cohort remains RSC-direct-DB for all three.

**M5 — Volume and capacity.** Add versioned YAML profiles for 100 and 1000 write scenarios, read-only k6 rate ladder, adapter conformance checks, telemetry, reports, and rotated repeated trials. Do not ship cross-variant Action mutation-capacity claims without validated real Action protocol. **Gate:** the effective config records exact fixture size, actual update/delete/create success counts, attempted rate, achieved throughput and failure reasons, with run-to-run spread.

**M6 — Expand cautiously.** Add a separately labelled read-location cohort, then ORM and external-backend cohorts. Each new standalone app supplies its own Compose, DB schema/seed/reset, package ecosystem, tests, and README, and passes copy-out and shared rig checks before inclusion.

### Work instructions for the coding agent

- Implement milestones in order; do not scaffold all variants before the schema, seed, config semantics, and rig correctness gate are proven.
- Before each milestone, write the failing contract/integration test; implement only enough to pass, then run app-local tests and the applicable external gate. Do not run expensive benchmarks in the inner development loop.
- After each milestone, provide a structured handoff: files changed; architecture decisions; exact build/test commands and actual pass/fail; schema/seed/config checks; known fairness limitations; and next milestone dependencies. Preserve raw failure artifacts.
- Do not claim performance findings from example YAML numbers. Measurements begin only after independent apps and rig correctness are verified.

## 9. First actionable implementation slice

Deliver **only M0 + M1** first: canonical four-table SQL, exact seed algorithm/golden hashes, template app with own install/Compose/Postgres/schema/seed, a minimal list/detail/create/update/delete UI, its app-local tests, and a copy-out standalone smoke test. Then implement M2–M3 against that reference before creating the tRPC/REST apps. This sequence makes the template a tested contract rather than a repository-shaped source of accidental shared dependencies.
