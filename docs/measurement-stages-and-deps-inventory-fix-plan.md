# Measurement stages + dependency inventory — fix plan

**Status:** ready to hand off · **Last updated:** 10 October 2026
**Trigger:** run `2026-10-10t15-15-18-542z` (`config/medium-load.yaml`) shows full
lifecycle results in the viewer, but the Correctness, Render, and Load sections
are empty, and `directDependencies` is 0 for every `spa-api` variant.

This plan is executable by an agent with no other context. §1 is the audited
diagnosis (evidence included — both symptoms were investigated against the real
artefacts, and **neither is a viewer bug**). §2–§5 are four small work packages;
§6 is the ordered gate list.

House rules still apply (`docs/live.md`, `src/reporting/README.md`): blank means
not measured, never zero; the viewer is a view over raw artefacts, never a
second copy of the data; no composite "best" score.

---

## 1. Diagnosis (audited 10 Oct 2026)

### 1.1 Correctness / render / load sections are empty — the run never measured them

Evidence from `results/2026-10-10t15-15-18-542z/`:

- `summary.json` → every variant's `stages` map contains exactly:
  `build, up, ready, reset, seed, verifySchema, verifyDigest, teardown`.
  There is **no** `correctness`, `render`, `load`, or `mutations` stage — those
  stage keys only appear when the corresponding flag is passed.
- `variants/<id>/` contains only `lifecycle.json` — no `render.json`
  (`--with-render`), no `load.json` / `k6-summary.json` (`--with-load`), no
  `mutations-summary.json` / `capture.json` (`--with-load` + a volume scenario).
- The viewer's "—" cells are correct behaviour (blank-never-zero rule): the
  artefacts behind those sections do not exist.

**Root cause:** the run was started without the measurement flags. The
controller only runs those stages when asked (`src/controller/cli.ts#parseArgs`,
cases `--with-correctness` / `--with-render` / `--with-load`). The correct
command for the full picture is:

```bash
pnpm rig:run --config config/medium-load.yaml --with-correctness --with-render --with-load
```

Flag semantics (documented in `docs/agent-handoff.md` R5–R7):

| Flag                 | What it runs                                                                         | Failure behaviour                                   | Rough added cost per variant (from 9 Oct smoke runs) |
| -------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------- |
| `--with-correctness` | shared black-box Playwright CRUD suite (`e2e/correctness.spec.ts`)                   | **fatal** — a failure makes the variant ineligible  | ~1–2 min                                             |
| `--with-render`      | pinned-Chromium render collector (`src/render/collect.ts`)                           | non-fatal — recorded, variant stays eligible        | ~2–5 min (15 measured samples at medium-load)        |
| `--with-load`        | k6 read leg + captured-request mutation replay (`load/read.js`, `load/mutations.js`) | non-fatal; generator-saturated numbers are withheld | ~2–4 min (capture + 15 s read + mutation volume)     |

Instruction gap (the part that _is_ ours to fix, per the confirmed direction):
stage selection is **CLI-only today**, so the natural one-argument run
(`pnpm rig:run --config config/medium-load.yaml`, exactly what the README's
examples show) silently produces a lifecycle-only run. The confirmed design is
**config-driven**: a `stages:` block in the YAML selects the measurement
stages (D4), the CLI flags remain only as one-off overrides, and
`preflight.json` records the _effective_ selection so the viewer can tell
"not requested" from "attempted and failed" (D1/D2) — today both render as
"—".

### 1.2 `directDependencies = 0` for the seven `spa-api` variants — inventory discovery bug

`src/reporting/inventory.ts#countDirectDependencies(appDirectory)` reads
`package.json` / `pyproject.toml` / `mix.exs` only at the **root** of
`appDirectory`. The seven `spa-api` variants have **no manifest at the root** —
each half keeps its own in a subdirectory (`<variant>/<api-half>/` and the SPA
half), so the function falls through every branch and returns 0. The viewer
faithfully displays the wrong number; the data was already wrong at collection
time (`inventory.json`, written once per run by the controller).

Audited reality (dependency-manifest locations and per-half direct-dependency
counts, computed from the working tree on 10 Oct 2026 — these are the numbers
the fix must produce):

| Variant                  | Manifests actually present                                                | Expected sum |
| ------------------------ | ------------------------------------------------------------------------- | ------------ |
| tanstack-express-rest    | `express-rest/package.json` (4) + `tanstack-rest/package.json` (10)       | 14           |
| tanstack-fastify-rest    | `fastify-rest/package.json` (4) + `tanstack-rest/package.json` (10)       | 14           |
| tanstack-express-graphql | `express-graphql/package.json` (6) + `tanstack-graphql/package.json` (11) | 17           |
| tanstack-express-orpc    | `express-orpc/package.json` (9) + `tanstack-orpc/package.json` (15)       | 24           |
| tanstack-flask-rest      | `flask-rest/pyproject.toml` (2) + `tanstack-rest/package.json` (10)       | 12           |
| tanstack-fastapi-rest    | `fastapi-rest/pyproject.toml` (1) + `tanstack-rest/package.json` (10)     | 11           |
| tanstack-elixir-rest     | `phoenix_rest/mix.exs` (20) + `tanstack-rest/package.json` (10)           | 30           |

Unaffected (manifest at root, already correct, must not change):
`next-actions` 5, `next-drizzle` 7, `next-prisma` 8, `next-trpc` 11,
`next-orpc` 15, `tanstack-start-react` 13, `tanstack-start-solid` 11.

Note for the handoff: `inventory.json` is a per-run raw artefact — old runs are
not backfilled (§7). The fix shows up from the next `rig:run` onward.

---

## 2. Work package D1 — record the effective stage selection in `preflight.json`

In `src/controller/cli.ts`, where `preflight.json` is written (~line 166),
add the **effective** stage selection (config `stages:` block ∪ CLI overrides,
see D4):

```jsonc
{
  "runId": "…",
  "gitRevision": "…",
  "config": "config/medium-load.yaml",
  "selected": ["…"],
  "effectiveManifestSha256": "…",
  "stages": { "correctness": true, "render": true, "load": true }, // NEW — effective, not just flags
}
```

- Values are the effective booleans the controller will actually run
  (config `stages` OR'd with any `--with-*` CLI overrides — D4).
- `preflight.json` is a written artefact, not zod-validated — safe to extend;
  keep the key name `stages` exactly (the viewer depends on it in D2).
- Also add `only: string[] | null` (the `--only` filter) while there — it
  explains partial runs in the viewer header (a 2-variant run is otherwise
  confusing next to 14-variant runs).

## 3. Work package D2 — viewer: "not requested" banners with the exact re-run command

In `src/reporting/viewer.ts`:

- `RunView` gains `requestedStages: { correctness: boolean; render: boolean; load: boolean } | null`
  — read from `preflight.json`; runs whose preflight predates D1 have no
  `stages` key → `null` → render the current "—" (never guess).
- For each of the Correctness / Render / Load sections, when the section has
  no data for any variant **and** `requestedStages.<x> === false`:
  - banner instead of a bare empty table:
    _"Not measured — this run's config selected no `<x>` stage. Re-run:
    `pnpm rig:run --config <configFile>` after setting `stages.<x>: true`, or
    add `--with-<x>` for a one-off"_ (configFile from `preflight.json#config`;
    escape it; copyable `<code>` block).
  - the Load banner should note it covers both legs (read-only + mutations).
- When `requestedStages.<x> === true` but data is missing/failed: keep current
  behaviour (stage row from `summary.json` stages / variant `error`), i.e. a
  _failed_ stage must never look like a _skipped_ one.
- Optional small win (recommended): the Inputs card shows the effective
  `stages` selection, same source.

Tests (`tests/viewer.test.ts` extend): synthesised runs with
(a) `stages.render: false` → banner containing the exact command;
(b) `stages.render: true` + failed render stage → no banner, error visible;
(c) no `stages` key (legacy run) → "—" unchanged.

## 4. Work package D3 — discover nested dependency manifests in the inventory

In `src/reporting/inventory.ts`, replace the root-only lookups in
`countDirectDependencies` with a manifest **discovery walk**:

- Walk `appDirectory` (bounded depth, ≤ 3) using the existing exclusion
  discipline — never descend into `EXCLUDED_DIRS` (`node_modules`, `dist`,
  `build`, `_build`, `deps`, `.venv`, `__pycache__`, …) and skip
  `EXCLUDED_FILES`. Only the app directory is walked — never the repo root.
- Collect every `package.json`, `pyproject.toml`, `mix.exs` found.
- **Counting semantics do not change** (discovery only, no redefinition):
  `package.json` → `dependencies` keys (devDependencies still excluded);
  `pyproject.toml` → the existing `dependencies = [...]` regex;
  `mix.exs` → the existing `{:dep,` regex (known to count Phoenix framework
  deps — that is today's definition of "direct" for Elixir; leave it).
- `StaticInventory` gains a transparency field, and `directDependencies`
  becomes the **sum** across manifests (backward compatible — the matrix's
  `direct_deps` column becomes meaningful for `spa-api` for the first time):

```ts
dependencyManifests: Array<{
  path: string; // relative to appDirectory, e.g. "express-rest/package.json"
  kind: "npm" | "python" | "elixir";
  directDependencies: number;
}>;
directDependencies: number; // sum of the above
```

- `pnpm-workspace.yaml` and lockfiles are not manifests — never counted.
- The viewer's static section keeps the sum as the headline; show the
  per-manifest breakdown in the cell's `title` tooltip (e.g.
  `express-rest: 4 + tanstack-rest: 10`).

Tests (`tests/` — synthesised tmp app trees): nested halves both counted;
`node_modules`/`dist` manifests ignored; npm + python + elixir mixed tree;
sum equals the parts; the audit table in §1.2 is the expected-values reference
(a live spot-check after implementation: `--only tanstack-express-rest`
rehearsal must report 14).

## 5. Work package D4 — config-driven stage selection (`stages:` in the YAML)

The confirmed design (user decision, 10 Oct 2026): stage selection lives in
the **config**, so the canonical command is exactly the simple one —
`pnpm rig:run --config config/medium-load.yaml` — with the YAML carrying the
rest. No `--full` flag; no stage flags to remember.

### 5.1 Schema (`src/config/schema.ts`)

New top-level block, mirroring the existing `load:` default pattern
(`loadSchema` already uses `.default()` inside the strict parent):

```ts
export const stagesSchema = z
  .object({
    correctness: z.boolean().default(false),
    render: z.boolean().default(false),
    load: z.boolean().default(false),
  })
  .strict()
  .default({ correctness: false, render: false, load: false });

// in rigConfigSchema (strict parent — this is the only new key):
stages: stagesSchema,
```

- **Backward compatible:** every existing YAML (including
  `config/examples/volume-1000-writes.yaml`) remains valid and behaves exactly
  as today (all stages off) because of the `.default()`.
- **Provenance for free:** the whole config is hashed into
  `effectiveManifestSha256` (`effectiveRunManifest`), so two runs differing
  only in stage selection already get different hashes — correct, stage
  selection is part of run identity.
- Unknown keys inside `stages:` are rejected like everywhere else (`.strict()`).
- Semantics of each stage are unchanged from §1.1's table (correctness fatal,
  render/load non-fatal; a `stages.load: true` config with no volume scenario
  runs the read leg only — that is existing behaviour, unchanged).

### 5.2 Controller (`src/controller/cli.ts`)

- Effective selection = `config.stages` OR'd with any `--with-correctness /
--with-render / --with-load` CLI flags. The flags stay **only** as one-off
  upward overrides (e.g. a quick `--only next-actions` rehearsal _with_ render
  from a lean config); they are no longer the primary mechanism and are not
  needed for any shipped config. No negation flags (`--without-…`) — for a
  one-off lean run, copy the config or flip the YAML.
- The effective booleans feed D1's `preflight.json#stages`, and drive the
  existing `runVariant` options exactly as the flags do today.

### 5.3 Shipped configs

Add to `smoke-matrix.yaml`, `medium-load.yaml`, `heavy-load.yaml`, and
`default.yaml` (the rehearsal and matrix runs all want the full picture —
the R8 gate was always run with all three flags anyway):

```yaml
stages:
  correctness: true
  render: true
  load: true
```

- `config/examples/volume-1000-writes.yaml` stays lean (no block → all off) —
  it remains the example of a lifecycle-only quick run.
- From here on, `pnpm rig:run --config config/medium-load.yaml` (and nothing
  else) produces correctness + render + load results.

### 5.4 Documentation

- `testing-rig/README.md`: canonical commands become the simple
  `pnpm rig:run --config <cfg>` (+ `--only` for rehearsals), plus the §1.1
  stage table (what each stage runs, fatality, cost) and one line noting the
  CLI `--with-*` overrides exist for one-off runs. The no-flag examples that
  caused this confusion are replaced.
- Wherever else flags are documented (`src/controller/README.md`,
  `docs/agent-handoff.md` next-steps), align with the same table.

### 5.5 Tests (`tests/config.test.ts`)

- A config with the full `stages:` block parses to all-true.
- A config without the block defaults all-false (backward compat).
- Unknown key inside `stages:` is rejected (strict).
- Non-boolean value is rejected.
- The shipped four configs load with stages all-true; the example config
  loads all-false.

---

## 5bis. Work package D5 (optional, confirm first) — first-render screenshots

The collector already drives a pinned Chromium over the same pages; capturing
what the user sees at the first-useful-data moment is one Playwright call.
Requested during review ("time to first render, maybe screenshots").

- `src/render/collect.ts`: on the **last measured sample** per page
  (`/projects`, `/projects/1`, `/tasks/1`), take one screenshot at the
  first-useful-data moment: `page.screenshot()` →
  `variants/<id>/render-<page>.png` (viewport size 1365×768, PNG). Three files
  per variant — bounded, no per-sample capture.
- One more per interaction is **not** wanted (bloat, no decision value).
- The viewer **links, never embeds** — `<img src="<run-id>/variants/<id>/render-<page>.png">`
  is a relative sibling of `results/index.html`, so it works over `file://`
  with no size cost to the page payload (unlike base64 embedding — do not).
  Render section gains a collapsible thumbnail strip per variant; a missing
  PNG (run without render, or pre-D5 run) renders as nothing, not a broken
  image (`onerror` hide or existence flag in the run view).
- Keep it behind the effective render stage selection (the config's
  `stages.render: true` or the `--with-render` override) — no new flag.
- Optional companion (cheap, recommended): a screenshot on **correctness
  failure** in `e2e/correctness.spec.ts` (`page.screenshot()` in the failure
  hook → `variants/<id>/correctness-failure.png`), so the viewer's failure row
  can show _what_ the user saw. Bounded: one file, only on failure.

Gate: a `--only next-actions` rehearsal (from a `stages.render: true` config)
writes the three PNGs; `pnpm report:all` shows thumbnails; a pre-D5 run shows
no broken images. `pnpm test`, `pnpm typecheck` green (collector tests
extended if they cover the sample loop).

## 6. Implementation order and gates

| Step | Work                                                    | Gate (must actually pass)                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | D3 inventory discovery + tests                          | `pnpm test` (new inventory tests green); `pnpm typecheck`                                                                                                                                                                                                                                                                                                                   |
| 2    | D1 preflight `stages` (+ `only`)                        | `pnpm test`; a throwaway `--only next-actions` smoke run writes `preflight.json` with the `stages` block                                                                                                                                                                                                                                                                    |
| 3    | D2 viewer banners + tests                               | `pnpm test`; `pnpm report:all` → the four existing runs (all pre-D1) still render with "—"; a synthesised flagged run in the unit tests shows the banner                                                                                                                                                                                                                    |
| 4    | D4 config-driven `stages` + shipped YAMLs + README/docs | `pnpm test` (schema tests: defaults, strict-unknown, non-boolean, four shipped configs all-true, example all-false); `pnpm typecheck`; `pnpm config:validate config/medium-load.yaml manifests` green; README's canonical command is the simple `pnpm rig:run --config <cfg>`                                                                                               |
| 5    | D5 screenshots (optional — only if confirmed)           | `--only next-actions` rehearsal (render selected via config) writes `render-<page>.png` ×3; viewer renders thumbnails; pre-D5 runs show no broken images                                                                                                                                                                                                                    |
| 6    | Rehearsal run (both cohorts)                            | `pnpm rig:run --config config/medium-load.yaml --only next-actions,tanstack-express-rest` → both variants ok — **no stage flags on the command line**; `render.json`, `load.json`, `mutations-summary.json` exist for both; viewer shows every section; `tanstack-express-rest` inventory reports `directDependencies = 14`; no generator saturation; preflight banner gone |
| 7    | Full medium-load matrix (user-scheduled)                | `pnpm rig:run --config config/medium-load.yaml` → 14/14 ok → viewer fully populated (correctness, render, read load, mutations, static incl. fixed dep counts)                                                                                                                                                                                                              |
| 8    | Handoff docs                                            | `docs/agent-handoff.md` new milestone entry (files changed, gates run with results, the §1.2 expected-values table reproduced with actuals); this file's status line updated                                                                                                                                                                                                |

Files touched: `src/config/schema.ts` (the only schema change — new
`stages` block), `src/controller/cli.ts`, `src/reporting/inventory.ts`,
`src/reporting/viewer.ts`, `tests/config.test.ts`, `tests/viewer.test.ts`
(+ a new inventory test file), `config/smoke-matrix.yaml`,
`config/medium-load.yaml`, `config/heavy-load.yaml`, `config/default.yaml`
(each gains the `stages:` block), `src/render/collect.ts` +
`e2e/correctness.spec.ts` (only if D5 is confirmed), `testing-rig/README.md`,
`src/controller/README.md`, `docs/agent-handoff.md`.
**No app changes. No new dependencies. No new CLI flags. No
measurement-logic changes** — the render/load/correctness stages themselves
are already correct; they were simply never selected.

---

## 7. Non-goals

- No backfill of old runs' `inventory.json` / `preflight.json` — raw artefacts
  are immutable history; the fix applies from the next run.
- No redefinition of "direct dependency" counting (npm `dependencies` only,
  existing pyproject/mix regexes) — D3 is _discovery_, not new semantics.
- No changes to how render/load/correctness are executed or reduced.
- No server, no external assets in the viewer (unchanged from the
  results-viewer plan).
