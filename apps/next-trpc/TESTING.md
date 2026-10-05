# Testing

Three tiers, three jobs. They share one dataset so a failure always points at
the code rather than at the data.

| Tier        | Runner           | Data                     | Needs a database |
| ----------- | ---------------- | ------------------------ | ---------------- |
| Unit        | Vitest (`jsdom`) | `tests/fixtures/data.ts` | no               |
| Integration | Vitest (`node`)  | seeded test database     | yes              |
| End-to-end  | Playwright       | seeded test database     | yes              |

## Layout

```
tests/
├── fixtures/
│   ├── data.ts       GENERATED from spec/snapshots/correctness/*.csv
│   ├── builders.ts   make*() factories with deliberately fake values
│   └── load.ts       reads a spec snapshot profile into typed rows
├── integration/      database lifecycle + query-layer tests
└── e2e/              specs, plus the isolated database lifecycle
```

Imports use two aliases, and the split is deliberate:

- `@/*` → `src/*` — app code
- `@tests/*` → `tests/*` — test code

A test helper can never be mistaken for something the app ships, and a page
still importing `@tests/fixtures/data` is a page that has **not** yet moved to
the database layer — visible at a glance while you migrate.

## The fixture

`spec/snapshots/correctness/*.csv` — **shared across every app variant** — is
the single source of truth: 3 projects, 3 people, 6 tasks, 3 comments. It lives
in `spec/` rather than inside this app so the tests here and the next variant
assert the same rows, rather than each app carrying its own drifting copy.

The benchmark profiles (`small`, `medium`, `large`) live alongside it and are
deliberately _not_ used for tests: they are sized for benchmark volume and use
`Project N` / `Task N` naming, which no test should assert on.

- **Integration and e2e** load those CSVs into a real Postgres and assert
  against the rows.
- **Unit** tests render `tests/fixtures/data.ts`, which is _generated_ from
  the same CSVs:

  ```sh
  pnpm test:data
  ```

  Do not hand-edit it. Because it is derived, a unit assertion and an e2e
  assertion of "Draft navigation model" are asserting the same row by
  construction.

> This is the fix for a real failure mode. The unit fixtures used to live at
> `src/test/data.ts` and were hand-written, so they drifted from the seeded
> database. That made the e2e suite fail for reasons unrelated to the code
> under test — `/projects` read Postgres while every other page read the mock
> array.

## Isolation

Integration and e2e run against **their own database**, never the developer's:

```
architecture_next_actions      ← your dev database (seeded from spec/snapshots/small)
architecture_next_actions_e2e  ← created, migrated, seeded, then dropped
```

The connection string is derived from `POSTGRES_URL` with only the database name
swapped, so both live on the same server with the same credentials. The suite
refuses to start if the URL does not point at the `_e2e` database
(`assertNotDevDatabase`), so a misconfiguration fails loudly instead of writing
to real dev data.

The e2e server also uses its own build directory (`NEXT_DIST_DIR=.next-e2e`,
port `3100`) because Next.js takes a lock on `.next` and would otherwise refuse
to start while `pnpm dev` was running.

## Running

```sh
pnpm test:unit          # component tests, no database
pnpm test:integration   # query layer against the seeded database
pnpm test:e2e           # full browser suite, all three engines
pnpm test:e2e --project=chromium
pnpm test:data          # regenerate src/test/data.ts from the CSVs
```

`pnpm test:run` runs unit and integration.

## What is not covered

- Every domain has moved to tRPC: `src/lib/actions.ts` is gone, and both reads
  and writes go through `src/trpc/routers/`. A procedure is exercised two ways —
  the component tests drive it through `tests/helpers/trpc-harness.tsx`, and the
  integration tests call it through `appRouter.createCaller({})` against the
  seeded database. When a procedure changes, both are the places to update.
- `search-input.test.tsx` crashes its Vitest worker with SIGABRT. This predates
  this setup and is unrelated to it.
