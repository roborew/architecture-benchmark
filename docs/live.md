# Live status

**Read this first in a new session, then
[`crud-benchmark-agent-build-plan.md`](./crud-benchmark-agent-build-plan.md).**

This file answers *where are we* and *what is next*. The plan answers *why the
project is shaped this way*. Neither duplicates the other — if something is only
in one of them, it belongs in the other.

**Last updated:** 30 September 2026

---

## Where we are

Phases 0 and part of 2 are done. **The next task is Phase 4: build the first
raw-SQL variant.** The template app is route- and component-complete.

```text
architecture-benchmark/
  apps/next-template/     component-complete UI, in-memory data, no DB yet
  spec/                   schema + seed spec + golden fixtures  ← normative
  testing-rig/            config schema + canonical generator; controller not built
  docs/                   this file, the plan, methodology, handoff notes
```

## What is done

- **Schema aligned to the template's types.** Added `users.email`,
  `projects.description`, `projects.created_at`. Status is stored as
  `'todo' | 'in progress' | 'done'` — identical to the app's `TaskStatus`, so no
  display-mapping layer exists anywhere.
- **Golden fixtures regenerated and verified.** Two independent generator runs
  are byte-identical; zero quote characters across all four CSVs, so the
  no-quoting invariant holds.
- **Zero ORM code in the repo.** No Drizzle, Prisma, or SQLAlchemy in any source,
  config, or schema file. Raw SQL only until explicitly told otherwise.
- **Blueprint salvaged then removed.** Its Zod config schema, canonical fixture
  generator, and spec artifacts were kept; the rest was deleted.

## Golden digest — the number every seed must reproduce

```text
11145bf81a9c2c89e08fa73119c924575cf8e3fadd661802f2d4648661781078
```

Regenerate with:

```bash
node testing-rig/src/fixtures/generate-fixture.mjs --profile small --out spec/snapshots/small
```

If this changes, every variant and every recorded measurement is invalid.

## Next task — Phase 4: `apps/next-sql`

Build the raw-SQL backend. Minimum pieces, in order:

1. `apps/next-template/db/schema.sql` — copy of `spec/schema.sql`, verbatim
2. A `pg` client module (raw `node-postgres`, no query builder)
3. `COPY` the four CSVs from `spec/snapshots/small/` into Postgres
4. Run `setval` on all four identity sequences so live inserts never collide
   with fixture IDs
5. Verify a re-export reproduces digest `11145bf8…`
6. One read path end-to-end — **dashboard first**, it exercises joins and aggregates
7. Then mutations: Server Actions for create / update / delete / create-with-comment

The dashboard is deliberately first: it is the richest read surface in the app
(four aggregates plus joins), so it exercises the query layer hardest.

## Known gaps and gotchas

| Item | Detail |
|---|---|
| `spec/contract.md` is stale | Still describes the old 3-route blueprint IA. Needs rewriting against the real ten routes before the parity suite is built. |
| `spec/queries.md` is partial | Covers project/task paths but not the dashboard aggregates or `/users` reads. |
| Determinism gate is generator-level | Verified twice in-process. Not yet verified through a live Postgres round-trip. |
| `package.json` name is wrong | `apps/next-template/package.json` still says `next-actions`. |
| Docker disk | Previously caused an `initdb` failure with "No space left on device" on this Mac. Host has since been tidied; verify before Compose work. |
| `dev-realistic` seed profile | Deferred deliberately. `bench-generated` uniform strings are better for payload-parity measurement. |

## Decisions worth not relitigating

These were settled explicitly. Changing them costs a full re-verification cycle.

- **Raw SQL first.** No ORM until explicitly instructed. Introducing one early
  defeats the purpose of the exercise.
- **The template app is the naming authority.** Where its types and the spec
  disagree, the spec changes.
- **The primary output is a decision matrix**, not benchmark numbers. Performance
  figures are supporting input, labelled _indicative single-host_.
- **The seed algorithm is pure arithmetic with no PRNG.** This is what lets a
  Python generator later produce byte-identical fixtures. Do not introduce a
  seeded PRNG.
- **Uniform generated strings** (`Task <i>`, not realistic names) keep payload
  widths constant, so response-size differences indicate architecture differences.
- **No `dev-realistic` data in benchmark runs** — uniform strings only.

## How to pick up in a new session

Ask: *"Read `docs/live.md`, then continue with Phase 4."* Everything needed to
start is in the repo — no conversation history required.
