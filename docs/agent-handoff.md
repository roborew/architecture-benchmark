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

## Next steps

1. Run `scripts/standalone-smoke.sh` on a machine with Docker disk space (M1
   copy-out gate).
2. Rig controller lifecycle (M2): Compose project/port management, reset/
   seed/verify through the seeder adapter, run metadata, try/finally cleanup.
3. Playwright correctness + serial browser timing suites (M3), against
   `template-next` first.
4. Only after M3 gates: scaffold `next-actions`, `next-trpc`, `next-rest` (M4).
