# Architecture benchmark — build plan (revision 2)

**Status:** implementation specification. **Date:** 30 September 2026.
**Supersedes:** revision 1 (`crud-benchmark-agent-build-plan.md` @ 27 Sep 2026).
**Audience:** coding agent implementing the repository.

---

## TODO

### Phase 0 — Reconcile the spec with the real UI (blocks everything)

- [ ] Add `projects.description`, `projects.created_at` to `schema.sql`
- [ ] Add `users.email` to `schema.sql`
- [ ] Rewrite `contract.md` against the actual IA (dashboard, `/tasks`, `/users`, three `new` routes)
- [ ] Rewrite `queries.md` to match, including dashboard aggregates
- [ ] Update `seed-spec.md` for the new column set
- [ ] Regenerate `spec/snapshots/small/` and record the new `combinedSha256`
- [ ] Re-run the determinism gate (two fresh reset→seed→export cycles)
- [ ] Add `dev-realistic` seed profile alongside `bench-generated`

### Phase 1 — Freeze the template app

- [ ] Rename `apps/next-static-data` → `apps/template-next`
- [ ] Add comments UI (task detail: 10 most recent; create-with-comment form)
- [ ] Adopt the `contract.md` `data-testid` set
- [ ] Freeze the UI contract; no further component changes after this point
- [ ] Pass the copy-out gate (blocked in blueprint by Docker disk — verify)

### Phase 2 — Rig foundation (reuse blueprint, extend)

- [ ] Extend config schema: `cachingProfile`, `coldWarmProfile`, `cohort`, `measured`
- [ ] Add `kind: build` scenario
- [ ] Controller lifecycle: Compose project/port management, try/finally cleanup
- [ ] Fixture load via seeder service + digest verification
- [ ] DB postcondition verifier
- [ ] Run metadata capture (digests, git rev, pinned versions)

### Phase 3 — Parity + timing harnesses

- [ ] Playwright correctness suite (external, no implementation selectors)
- [ ] Playwright serial timing suite
- [ ] k6 read-only smoke load
- [ ] Deliberately-stale-UI test proves the harness detects drift

### Phase 4 — First measured variant

- [ ] `apps/next-sql` — raw SQL (`node-postgres`), RSC reads, Server Action mutations
- [ ] Own Compose, schema, seed, reset, README, tests
- [ ] Pass the unchanged Phase 3 correctness suite

### Phase 5 — Data-access cohort

- [ ] `apps/next-drizzle`
- [ ] `apps/next-prisma`

### Phase 6 — Transport cohort

- [ ] `apps/next-trpc`
- [ ] `apps/next-rest`
- [ ] `apps/next-express` (Next + separate Express API)

### Phase 7 — Client and runtime cohorts

- [ ] `apps/react-express` (React SPA + Express + Prisma)
- [ ] `apps/fastapi-react` (FastAPI + SQLAlchemy + React SPA)
- [ ] Python seed generator producing byte-identical fixtures

### Phase 8 — Decision matrix

- [ ] Define the variant card template
- [ ] Collect quantitative inputs for every variant
- [ ] Write the qualitative card for every variant
- [ ] Generate the cross-cohort comparison report

### Phase 9 — Infrastructure

- [ ] Provision the Ubuntu rig host
- [ ] Verify local Docker disk headroom
- [ ] Automate variant bring-up from manifest alone

---

## 1. Objective

Compare candidate application architectures so that a choice can be made later,
with evidence rather than intuition.

The primary output is a **decision matrix**: for each architecture, what it is
good at, what it costs, and when to choose it over the alternatives. Performance
numbers are a supporting input — collected consistently enough to be indicative,
never presented as precise claims.

This is a deliberate change from revision 1, which optimised for defensible
performance measurement. That goal required expensive machinery — trial rotation,
fairness invariants, cold/warm decomposition — that is mostly wasted if the
numbers are never load-bearing. The rig is now built for **consistency and
equivalence**, which is cheaper to achieve and sufficient for the stated purpose.

**Consequence:** all results are labelled _indicative single-host measurements_.
No result supports a claim of the form "X is N% faster than Y" across cohorts.

## 2. Reference app

`apps/template-next` is the frozen UI contract: routes, roles, `data-testid`s,
form semantics, expected outcomes. It renders from an in-memory module and is
**never measured** — it has no database, no write path, and no `database-recreate`
reset, so fixture and resource parity cannot hold.

Its job is to (a) define the contract, (b) validate the parity harness before any
database-backed variant exists, and (c) serve as the copy-source for every variant.

## 3. Variant taxonomy

Breadth is the point. The cost of breadth is that variants differ along four
independent axes, and a comparison is only meaningful within a cohort.

| Axis            | Values                                            |
| --------------- | ------------------------------------------------- |
| **Data access** | raw SQL · Drizzle · Prisma · SQLAlchemy           |
| **Transport**   | Server Actions · tRPC · REST                      |
| **Client**      | Next SSR/RSC · React SPA                          |
| **Stack shape** | Next full-stack · Next + separate API · SPA + API |

### Cohorts

| Cohort                   | Variant         | Axis moved                    | Held fixed                               |
| ------------------------ | --------------- | ----------------------------- | ---------------------------------------- |
| —                        | `template-next` | _reference only_              | n/a                                      |
| **A — data access**      | `next-sql`      | driver (raw SQL baseline)     | framework, transport, schema, queries    |
|                          | `next-drizzle`  | ORM/query builder             | ″                                        |
|                          | `next-prisma`   | ORM/client                    | ″                                        |
| **B — transport**        | `next-trpc`     | transport (typed RPC)         | framework, data access (Drizzle), schema |
|                          | `next-rest`     | transport (plain HTTP)        | ″                                        |
| **C — stack split**      | `next-express`  | API moved to separate process | framework, data access (Drizzle)         |
| **D — client + runtime** | `react-express` | client (no SSR) + API         | data access (Prisma)                     |
|                          | `fastapi-react` | client + language/runtime     | data access (SQLAlchemy)                 |

**Rule:** only variants within a cohort may be compared directly. Cross-cohort
comparison is permitted only as indicative narrative with the moved axes named.
Cohorts A, B, C differ from each other by one axis; D differs from all of them by
two or more.

### Selection guide

The cohort structure encodes the intent:

- _Want to pick an ORM?_ Compare within **A**. Everything else is noise there.
- _Want to pick a transport?_ Compare within **B**.
- _Should the API be a separate service?_ Compare **C** against **A/B**.
- _Do I need a non-Next stack at all?_ **D** answers a different question — it is
  not competing on speed, it is competing on language fit and deployment shape.

## 4. Shared specification

`spec/` is the equivalence root. It is copied, never imported at runtime.

| File                 | Contents                                                            |
| -------------------- | ------------------------------------------------------------------- |
| `contract.md`        | Screens, CRUD semantics, `data-testid`s, outcomes, visibility rules |
| `schema.sql`         | Authoritative DDL                                                   |
| `seed-spec.md`       | Deterministic generation algorithm                                  |
| `seed-profiles.yaml` | `small` / `medium` / `large`, plus `dev-realistic`                  |
| `queries.md`         | Result shape, filters, pagination, expected SQL                     |
| `snapshots/small/`   | Golden CSVs, `SHA256SUMS`, `manifest.json`                          |

**Cross-language determinism is a hard constraint.** The seed algorithm is pure
arithmetic with no PRNG, and the CSV format forbids quoting and fixes line
endings. This is what allows a Python generator to produce byte-identical output
to the TypeScript one. Any change that introduces a seeded PRNG, a locale-dependent
format, or platform-dependent line endings forfeits FastAPI's eligibility.

**Uniform generated strings are deliberate.** `Task <i>`, `Project <i>`,
`User <i>` keep payload widths constant, so a response-size difference between
variants indicates an architecture difference rather than a data difference.
`dev-realistic` exists for local visual work only and is never loaded by the rig.

## 5. Rig design

Independent pnpm project under `testing-rig/`. Three suites plus a controller.

```
testing-rig/
  config/           default.yaml + examples/
  manifests/        one per variant
  src/config/       Zod load + validate + effective-manifest hashing
  src/controller/   Compose lifecycle, fixture load, verification, cleanup
  src/fixtures/     canonical generator
  playwright/correctness/    unchanged across all variants
  playwright/timing/         serial per variant
  k6/                       read-only smoke load
  src/reporting/             decision matrix generation
```

### Variant manifest

```yaml
schemaVersion: 2
id: next-drizzle
cohort: A
differsFrom: next-sql
heldFixed: [framework, transport, schema, queries, cachingProfile]
measured: true
cachingProfile: uncached
coldWarmProfile: coldBrowser-warmApp-warmDb
appDirectory: ../apps/next-drizzle
composeFile: ../apps/next-drizzle/compose.yaml
projectPrefix: bench-next-drizzle
healthPath: /healthz
appHostPortEnv: APP_PORT
composeServices: { app: app, db: db, seeder: seeder }
seedCommand: [docker, compose, run, --rm, seeder, seed]
resetCommand: [docker, compose, run, --rm, seeder, reset]
capabilities: [list, detail, create, update, delete, create-with-comment]
readMode: rsc-direct-db
mutationMode: server-action
```

`template-next` sets `measured: false` and is excluded from every report table.

`differsFrom` and `heldFixed` are documentation and report labelling, not hard
enforcement — the rigor-first version enforced these at validation time, which is
no longer worth the complexity.

### Scenario kinds

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

  - id: build-cold
    kind: build
    measures: [wallClockSeconds, peakMemoryMb, imageDigest]
    trials: 3
```

`build` is new and is a headline dimension rather than a footnote — cold build
time and peak memory vary substantially by ORM and are a real cost of adoption.

Volume means _successful state changes against predetermined distinct records_.
Offered and achieved counts are recorded separately. An update is not successful
because a request returned 200.

### Caching

Caching is a declared per-variant profile, not a separate variant.

| Profile              | Configuration                                                   |
| -------------------- | --------------------------------------------------------------- |
| `uncached`           | `force-dynamic` / `no-store` on every read path — **normative** |
| `rsc-tag-revalidate` | tagged Data Cache + `revalidateTag` on mutation                 |
| `route-cache`        | Full Route Cache / ISR with a fixed revalidate window           |

Never compare rows with different `cachingProfile` or `coldWarmProfile` values.
Application-level result caches (Redis, memoized results) are out of scope: they
change the load the database observes and add a service that breaks parity.

Connection pool size, statement mode, and `shared_buffers` must be identical
across every database-backed variant. Differences here are confounds.

### Cold and warm

Declared per variant as a named triple, reported on every row:

| Layer    | Cold means                                              |
| -------- | ------------------------------------------------------- |
| Browser  | empty HTTP cache, no cookies — fresh Playwright context |
| App      | empty Data/Route cache, cold JIT — restart container    |
| Database | empty shared buffers — restart container                |

Restarting the app container does **not** clear Postgres caches, so
`coldBrowser-warmApp-warmDb` is the common default. Cold app start is worth
measuring deliberately — it differs sharply between Next.js and FastAPI — but
cold database is a separate labelled profile, not the default.

### The port

Every variant implements one `TaskRepository` interface with fixed signatures.
Pages import only the port, never a driver or ORM client. This is what makes a
backend swap a swap rather than a rewrite, and it is what makes the comparison
honest: the measured difference is the adapter, not an accident of wiring.

Keep the port thin. A fat abstraction layer adds indirection cost that becomes
part of every measurement. Identical across variants is what matters, not zero.

## 6. Decision matrix — the actual deliverable

Each measured variant produces a card. The numbers are one section of it.

```markdown
## next-prisma (cohort A · differs from next-sql: ORM/client)

**Good at:** type-safe schema inference; fastest to first prototype; mature studio
tooling; readable nested queries.

**Costs:** ~2.1× cold build time vs raw SQL; explicit N+1 risk on list views;
generated client adds a codegen step to every schema change.

**Choose it when:** schema churn is high, the team is not fluent in SQL, or
prototype speed dominates delivery cadence.
**Avoid it when:** query volume is high and latency-sensitive, or you need
raw-SQL escape hatches frequently.

| Metric         | Value |
| -------------- | ----- |
| list p95       | …     |
| create p95     | …     |
| cold build     | …     |
| peak build RSS | …     |
| app LOC (src/) | …     |
```

Qualitative sections are written by hand and are the primary content. Quantitative
sections are generated. A variant with no measurements still gets a card.

Report structure: one table per cohort, plus a narrative section for cross-cohort
questions (should the API be separate? is Next the right frame at all?).

## 7. Fairness and labelling

Lightened from revision 1. Retained only what protects comparability.

Retained:

- Identical schema, indexes, fixtures (digest-verified), and reset behaviour
- Identical production builds and resource caps
- Reset between correctness, timing, and load phases
- Run correctness before any measurement; a failure invalidates that result
- Serial measurement runs per variant
- Explicit labelling of click-to-visible-committed vs HTTP completion

Dropped:

- Strict `heldFixed` resolution and enforcement
- Trial rotation with `trials: 5` (reduced to 3)
- Network latency shaping (`browserToAppAddedRttMs` stays 0)
- `pg_stat_statements` snapshots
- Full cold/warm decomposition per layer

Every report row carries: variant, cohort, `differsFrom`, `cachingProfile`,
`coldWarmProfile`, fixture profile and digest, build digest, and the
_indicative single-host_ label.

## 8. Milestones

Work in order. Do not scaffold a variant before the rig can validate it.

**M0 — Spec reconciliation.** Rewrite `contract.md`, `queries.md`, and
`schema.sql` against the real UI; update `seed-spec.md`; regenerate snapshots.
**Gate:** two fresh reset→seed→export cycles produce byte-identical rows and the
recorded digest.

**M1 — Template freeze.** Rename, add comments UI, adopt contract testids, freeze.
**Gate:** copy-out passes with no repo-relative imports; all ten routes render.

**M2 — Rig foundation.** Extend the blueprint's existing config schema; add the
controller lifecycle, fixture loading, verification, and run metadata.
**Gate:** starts a variant, loads small and medium fixtures, verifies digests,
survives a forced failure, and cleans up without touching other stacks.

**M3 — Parity and timing.** External Playwright correctness suite, serial timing
suite, k6 smoke.
**Gate:** suite runs unchanged against `template-next`; deliberately stale UI and
a failed write are both detected; baseline variance documented.

**M4 — First measured variant.** `next-sql`.
**Gate:** passes the unchanged M3 suite; build digest recorded.

**M5 — Data-access cohort.** `next-drizzle`, `next-prisma`.
**Gate:** each passes copy-out and the unchanged M3 suite.

**M6 — Transport cohort.** `next-trpc`, `next-rest`, `next-express`.
**Gate:** as above, plus adapter conformance proving each exercises its real
transport path with identical postconditions.

**M7 — Client and runtime cohorts.** `react-express`, `fastapi-react`.
**Gate:** as above; the Python generator reproduces the TypeScript fixture digest
byte-for-byte.

**M8 — Decision matrix.** Cards for every variant, cohort tables, cross-cohort
narrative.
**Gate:** every measured variant has a card; every comparison names its cohort.

### Work instructions

- Write the failing contract or integration test before implementing.
- Do not run expensive benchmarks in the inner development loop.
- After each milestone, record: files changed, decisions made, exact commands with
  actual pass/fail, known limitations, next dependencies.
- Do not claim a performance finding from configuration values.
- Preserve raw failure artifacts.

## 9. Open decisions

1. **FastAPI seed conformance** — implement the Python generator early, before
   the first FastAPI variant, to prove cross-language determinism. Cheap to
   de-risk, expensive to discover late.
2. **React SPA browser metrics** — "first useful-data render" means something
   different without SSR. Decide whether SPA variants report a different metric
   set or are excluded from browser timing.
3. **Deployment realism** — should variants be measured as containers, or should
   build/start time include a realistic deploy path? Affects the build card.
4. **Depth vs breadth** — nine variants is a lot of surface. If effort becomes the
   binding constraint, cohorts A and B are the ones that answer real questions;
   D can be deferred to a single representative variant.
