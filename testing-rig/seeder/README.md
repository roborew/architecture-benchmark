# `bench-seeder` — the canonical fixture loader

One image, shared by every variant stack. It is the concrete form of the plan
§4 blessing: identical fixtures via a seeder service rather than a per-app
generator, so no app image contains — or walks to — the repo's `spec/`.

## Contract

The image entrypoint is `node seed.mjs`. Three modes, selected by the first
argument (the controller passes the rest via Compose):

| Mode | argv | Effect |
|---|---|---|
| `seed` | `seed [profile]` | `DROP SCHEMA public CASCADE` → apply `schema.sql` → generate the fixture → `COPY` the four CSVs → `setval` the identity sequences → export+hash |
| `reset` | `reset` | `DROP SCHEMA public CASCADE` → apply `schema.sql` (no data) |
| `verify` | `verify [profile]` | export the canonical CSVs and hash them |

- Connection comes from `POSTGRES_URL` (in-stack: `postgresql://bench:bench@db:5432/bench`).
- The fixture is either `SEED_FIXTURE` (a JSON blob — the experiment config's
  `fixture:` object, used for every measured run) or a named profile
  (`SEED_PROFILE` / argv: `small`, `medium`, `large`).
- Each mode prints exactly one JSON line on stdout. `seed` exits non-zero if
  the loaded rows do not reproduce the generator's digest, or the row counts
  disagree — a corrupt fixture fails loudly, before any timing.
- The canonical export in `canonical-export.json` casts timestamps with
  `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` so the bytes equal the golden
  CSV (spec/seed-spec.md), independent of Postgres' default `timestamptz` text.

## Kept in sync with the spec

`schema.sql` and `generate-fixture.mjs` are copies of `spec/schema.sql` and
`testing-rig/src/fixtures/generate-fixture.mjs`. `tests/seeder-sync.test.ts`
asserts they are byte-identical to their sources, so the copy-out rule cannot
silently rot.

## Build

```bash
docker build -t bench-seeder:local testing-rig/seeder
```
