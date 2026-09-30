# Golden snapshots

Checked-in canonical fixture exports per profile, produced by the canonical
generator (`testing-rig/src/fixtures/generate-fixture.mjs`) implementing
`spec/seed-spec.md` v1.

- `small/` is the golden profile: app-local seed implementations must produce
  rows whose CSV export matches `small/SHA256SUMS` and
  `small/manifest.json#combinedSha256` **exactly**.
- `medium/` and `large/` are generated on demand (once per profile) rather
  than committed; their digests are recorded in the run's effective config.

Regenerate and verify determinism:

```bash
node testing-rig/src/fixtures/generate-fixture.mjs --profile small --out spec/snapshots/small
shasum -a 256 spec/snapshots/small/*.csv   # compare against SHA256SUMS
```

M0 gate: two fresh regenerations are byte-identical, and the same digests are
observed after a fresh reset→seed→export cycle against a live database.
