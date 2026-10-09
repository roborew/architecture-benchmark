# Render-speed collector (plan §6.4)

`collect.ts` drives a fixed, pinned Chromium at a fixed viewport and records raw
per-sample rows. It **asserts nothing** — a render figure is an *indicative
single-host* measurement, not a gate. The controller runs it as a non-fatal
`render` stage (`pnpm rig:run … --with-render`); a failure is recorded in the
run artefacts but does not invalidate the variant.

## What it measures

- **Navigation** on data-bearing pages (`/projects`, `/projects/1`, `/tasks/1`):
  TTFB (`responseStart`), FCP, LCP (a `PerformanceObserver` installed before
  navigation), and **first-useful-data** — `performance.now()` at the moment the
  page's first data element (`project-link` / `task-row` / `task-detail`) is
  visible.
- **Interaction**, click-to-visible-committed (wall clock, since it spans
  navigation): create, update, delete, create-with-comment — each timed until the
  persisted result is visible.

Cold browser context per sample (the app stays warm), warmup samples discarded
(`browser.warmupSamples`), `browser.measuredSamples` kept. Output JSON:
`results/<run-id>/variants/<id>/render.json`. `src/reporting` reduces it to p50
columns.

## Env

`BENCH_BASE_URL`, `BENCH_VARIANT`, `BENCH_WARMUP`, `BENCH_MEASURED`,
`BENCH_RENDER_REPORT` (output path).

## Known limitations

- **Single host, single Chromium** — labelled indicative; not a lab result.
- FCP/LCP can be missing on the client-rendered SPAs (the paint entry is read
  immediately after the data locator appears), and LCP occasionally reads 0 when
  the observer does not fire; those cells are blank, never an assertion.
- The SPA delete timing (~7 s in the smoke run) reflects the SPA's post-delete
  refetch, not the API; it is a real architectural difference and is reported
  as-is.
- Cold **browser context**, not a cold app (the app stays warm, per plan §5).
