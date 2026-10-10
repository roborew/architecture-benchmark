# Methodology

How measurements are taken, what can be compared, and what rejects a trial.
Sourced from the build plan (§0, §5–§7); this file is the checked-in record of
the fairness rules the rig implements.

## Two kinds of comparison (never conflated)

1. **Workload volume:** DB size fixed, operation count rises (e.g. 100 → 1000
   successful mutations). Volume means _successful state changes against
   predetermined distinct records_, not attempts that may silently target
   stale rows. Offered and achieved counts are recorded separately.
2. **DB-size sensitivity:** operation count and mix fixed, database grows
   (1,000 → 50,000 → 500,000 tasks).

"1000 writes" never means "1000 rows seeded"; accumulation/soak runs that
intentionally skip resets report the changing row count and DB size as part of
the independent variable.

## Metrics and labels

- **Click-to-visible-committed:** user-facing mutation timing, complete only
  when the persisted result is visible. Never labelled INP.
- **k6/HTTP completion:** a different metric, always labelled as such.
- Per-op p50/p95/p99 reported only where sample sizes justify it; trial spread
  is always reported.
- Warmup samples are discarded; measurement runs are serial per variant.
- A cold browser context does not imply a cold app process.
- **Container CPU/RAM** are recorded per variant during each load leg, as percent
  **of the service's `resources:` envelope** (not of the host): app CPU budget,
  app RAM budget, and OOM kills. A container pinned at ~100 % of its envelope is
  a _result_, never a trial rejection — the rig measures, it does not gate. Only
  **generator** saturation rejects (a saturated generator measures itself).

## Fairness invariants (phase 1)

- Identical canonical schema, indexes, fixtures (digest-verified), and reset
  behavior across variants; identical builds (production mode), resource caps,
  and DB network topology.
- Reset between correctness, browser measurement, and load phases
  (`database-recreate`, no app restart except an explicit cold-start profile).
- Load generators are monitored; generator saturation rejects the trial.
- Playwright timing runs and k6 are separated on a single host; results are
  labelled relative single-host measurements unless the generator runs on a
  separate machine.
- No separate backend service exists in phase 1, so `appToApiAddedRttMs`
  cannot be applied (the config validator rejects nonzero values).

## Rejection criteria (plan §7)

A trial is rejected on: schema/fixture checksum mismatch; missing or extra
required UI data; persistence check failure; unexpected retries; insufficient
unique eligible write targets; missing measurement samples; wrong build mode;
unaccounted cache/prefetch differences; resource throttling outside defined
caps; load-generator saturation; or an Action mutation-capacity comparison made
without a validated real Action protocol adapter.
