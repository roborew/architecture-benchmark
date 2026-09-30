# Golden snapshots

Checked-in canonical fixture exports per profile, produced by the canonical
generator (`testing-rig/src/fixtures/generate-fixture.mjs`) implementing
`spec/seed-spec.md` v1.

- `small/` is the golden profile: app-local seed implementations must produce
  rows whose CSV export matches `small/SHA256SUMS` and
  `small/manifest.json#combinedSha256` **exactly**.
- `medium/` and `large/` are generated on demand (once per profile) rather
  than committed; their digests are recorded in the run's effective config.
- `correctness/` is the **correctness** profile: a small, hand-curated dataset
  (3 projects, 3 people, 6 tasks, 3 comments) with realistic names, sized to be
  asserted by name in tests rather than by volume.

  Unlike the benchmark profiles it is _not_ produced by the v1 arithmetic
  algorithm — its rows are curated because tests assert exact strings such as
  `"Website redesign"`, `/tasks/101` and a comment count of 2. Task ids start at
  101 so they cannot be confused with benchmark ids. It is committed, not
  generated, and has no `manifest.json`/`SHA256SUMS` digests to reproduce.

  It exists so every app variant's test tiers assert the same rows: unit
  fixtures are generated from these CSVs, and integration and end-to-end suites
  seed them into an isolated database. That is what keeps a test failure
  attributable to code rather than to data drift.

Regenerate and verify determinism:

```bash
node testing-rig/src/fixtures/generate-fixture.mjs --profile small --out spec/snapshots/small
shasum -a 256 spec/snapshots/small/*.csv   # compare against SHA256SUMS
```

M0 gate: two fresh regenerations are byte-identical, and the same digests are
observed after a fresh reset→seed→export cycle against a live database.
