# Seed specification — deterministic fixture algorithm

**Version 1 (`seedVersion: 1`).** This document is normative. The canonical
generator (`testing-rig/src/fixtures/generate-fixture.mjs`) and every
app-local seed implementation (e.g. `apps/template-next/src/server/seed-generator.ts`)
must produce **byte-identical** exported rows for the same parameters. Tests
verify exact SHA-256 digests against `spec/snapshots/<profile>/`.

## Parameters

| Name                     | Type        | Constraints                                                        |
| ------------------------ | ----------- | ------------------------------------------------------------------ |
| `seedVersion`            | int         | must be `1`                                                        |
| `seed`                   | int         | reserved; v1 draws no pseudorandom numbers (pure arithmetic)       |
| `projectCount` (P)       | int         | ≥ 1                                                                |
| `userCount` (U)          | int         | ≥ 1                                                                |
| `taskCount` (N)          | int         | ≥ 1                                                                |
| `commentCount` (C)       | int         | ≥ 0                                                                |
| `baseTimestamp`          | UTC instant | whole seconds; all fixture timestamps derive from it               |
| `statusPercent`          | map         | keys `todo`, `doing`, `done`; positive ints summing to exactly 100 |
| `workingSetFraction` (f) | number      | 0 < f ≤ 1; controls the hot set (see pools below)                  |

No database `random()`, wall-clock time, unordered row scans, or Faker defaults.

## Row generation (v1)

All ids are explicit 1-based BIGINTs: users `1..U`, projects `1..P`,
tasks `1..N`, comments `1..C`.

**users** — `id`, `display_name = "User <id>"` (e.g. `User 7`), `email = "user<id>@example.test"`.

**projects** — `id`, `name = "Project <id>"`, `description = "Description for project <id>"`, `created_at = baseTimestamp + (id - 1) seconds`.

Project `created_at` values are deliberately spaced one second apart and overlap
the task timestamp range; they are never compared against task timestamps and no
ordering query depends on them.

**tasks** — for `i` in `1..N`:

- `project_id = 1 + ((i - 1) mod P)`
- `assignee_id = 1 + ((i - 1) mod U)`
- `title = "Task <i>"`
- `description = "Description for task <i>"`
- `status = cycle[(i - 1) mod 100]` where `cycle` is built by repeating each
  status, in the fixed order **todo, doing, done**, `statusPercent` times
  (e.g. 50/30/20 → `todo`×50, `doing`×30, `done`×20 concatenated)
- `created_at = baseTimestamp + (i - 1) seconds`
- `updated_at = created_at + 60 seconds`

**comments** — for `j` in `1..C`:

- `task_id = 1 + ((j - 1) mod N)`
- `author_id = 1 + ((j - 1) mod U)`
- `body = "Comment <j> on task <task_id>"`
- `created_at = baseTimestamp + N seconds + (j - 1) seconds`
  (all comment timestamps fall after every task `created_at`)

## CSV export format

One file per table, canonical column order, LF line endings, a header row, a
trailing newline at EOF, and no quoting (generated values never contain
commas, quotes, or newlines). Timestamps are ISO 8601 UTC at whole-second
precision: `YYYY-MM-DDTHH:MM:SSZ`.

- `users.csv`: `id,display_name,email`
- `projects.csv`: `id,name,description,created_at`
- `tasks.csv`: `id,project_id,assignee_id,title,description,status,created_at,updated_at`
- `comments.csv`: `id,task_id,author_id,body,created_at`

## Digests

- Per-file SHA-256 recorded in `SHA256SUMS` (`<sha256>  <filename>`).
- `combinedSha256` = SHA-256 over the byte concatenation
  `users.csv ∥ projects.csv ∥ tasks.csv ∥ comments.csv`.
- `manifest.json` additionally records profile name, parameters, row counts,
  and eligibility pools. It contains **no timestamps** so regeneration is
  byte-identical.

## Identity sequence advancement

After explicit-id bulk inserts, each app/seed loader must run:

```sql
SELECT setval(pg_get_serial_sequence('users',    'id'), (SELECT max(id) FROM users));
SELECT setval(pg_get_serial_sequence('projects', 'id'), (SELECT max(id) FROM projects));
SELECT setval(pg_get_serial_sequence('tasks',    'id'), (SELECT max(id) FROM tasks));
SELECT setval(pg_get_serial_sequence('comments', 'id'), (SELECT max(id) FROM comments));
```

so live inserts allocate fresh ids that never collide with fixture ids.

## Eligibility pools (workload namespaces)

Fixture task ids are partitioned into disjoint bands so simultaneous workers
never mutate the same row (a separately labelled contention profile may
change this):

- **readPool**: ids `1 .. floor(N / 2)`
- **hot set**: first `ceil(readPoolSize * f)` ids of the readPool — reads are
  drawn from here in hot-set profiles; publish wide-working-set runs separately
- **updatePool**: ids `floor(N / 2) + 1 .. floor(4N / 5)`
- **deletePool**: ids `floor(4N / 5) + 1 .. N` (deleting a task cascades its comments)
- **create-with-comment** tests always create _new_ tasks (unique per-run
  titles like `Created task <runId>-<n>`); they never reuse fixture rows.

Eligibility checks (run **before** any timed work): `deletePoolSize ≥ requested
deletes`, `updatePoolSize ≥ requested updates`, pools pairwise disjoint, and
with `C ≥ N` every deletePool task has at least one comment to cascade.
Impossible plans are rejected before starting.

## Determinism gate (M0)

Regenerating the same profile must yield byte-identical files, and exporting
the loaded rows from a fresh database must yield the same digests after two
independent reset→seed→export cycles.
