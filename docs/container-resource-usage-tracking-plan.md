# Container CPU/RAM usage tracking — implementation plan

**Status:** proposed (not implemented) · **Last updated:** 10 October 2026
**Scope:** measure and record the actual CPU / RAM usage of each variant's
**app and db containers** during the load stages (read leg, mutation replay,
capacity ladder), as a first-class metric alongside throughput and latency —
"did the variant max out its 2-CPU envelope, or eat all its RAM" — and surface
it in the decision matrix and the results viewer.

Standalone; no config-language changes required. House rules unchanged: blank
means not measured, never zero; the rig measures, it does not gate; the viewer
is a view, never a second copy of the data.

---

## 1. The standing questions

### 1.1 What do we track today?

Three resource-adjacent things exist, none of which is this measurement:

| Existing                                                 | What it is                                                                                                                  | Not it because…                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Resource **envelope caps** (`resources:` → `composeEnv`) | `deploy.resources.limits.cpus/memory` injected into every stack, enforced by cgroups; the _input_ side of the matrix        | Caps say what the container _may_ use, not what it _did_ use.                                                |
| **Generator** CPU sampling (`runK6Container`)            | `docker stats --no-stream` on the `bench-k6-*` container each second; `generatorMaxCpuPercentObserved` in every load report | Measures the load generator (a validity guard — a saturated generator measures itself), never the app or db. |
| `pg_stat_statements` deltas                              | DB _query_ work before/after each leg                                                                                       | Server-side DB insight, not container CPU/RAM, and nothing at all for the app container.                     |

**The gap:** during a load leg, nobody looks at the variant's own containers.
If `next-drizzle @ 2c2g` tips over at 40 rps, we cannot currently say whether it
was CPU-bound (app pinned at ~100 % of its 2-CPU cap), RAM-bound, or DB-bound.
That is exactly the cross-envelope fact the matrix wants.

### 1.2 Can k6 track it?

**No.** k6 runs inside the generator container and observes the HTTP
conversation from the client side; it has no visibility into the target
containers' CPU or memory. k6's own-container CPU we already sample (§1.1).
Extending k6 (Cloud output, Prometheus remote write, etc.) is explicitly a
non-goal here (§6). The correct source is **Docker**, whose stats we already
invoke once per second in the sampling loop — this plan points that existing
mechanism at the containers under test.

## 2. Source choice

| Source                                                      | Verdict   | Why                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Engine API `GET /containers/{id}/stats?stream=false` | **adopt** | One request per container per tick over the local socket (stdlib `node:http` with `socketPath`, no new dependency). Returns **raw cumulative counters** (`cpu_usage.total_usage`, `precpu_stats`, `system_usage`, `online_cpus`, `memory_stats.usage/limit`, `inactive_file`, `events.oom_kill`) — so we compute usage ourselves, version-independently.        |
| `docker stats --no-stream --format …` CLI                   | fallback  | Matches today's pattern, but the CLI hands back **pre-formatted strings** (no raw counters), and its CPU% normalization varies across Docker versions (percent-of-host-cores in older releases, percent-of-container-limit in newer ones when `--cpus` is set). Ambiguous units are exactly the number this benchmark is about — do not build the metric on it. |
| cAdvisor / Prometheus / Grafana stack                       | reject    | A second metrics pipeline to own; heavier than the rig's process-spawning style; violates the no-external-assets house rules for the viewer.                                                                                                                                                                                                                    |
| k6 Cloud / APM integrations                                 | reject    | Network + account; measures the generator side; §1.2.                                                                                                                                                                                                                                                                                                           |

The CLI fallback keeps the rig working when the socket is unreachable
(`DOCKER_HOST` pointing at a remote/ssh daemon, odd Desktop installs):
if the socket probe fails, poll `docker stats --no-stream --format json`
once per tick (a single invocation covers **all** of the project's containers)
and record `source: "cli"` with the normalization caveat in the artefact.

## 3. Design

### 3.1 What gets sampled

Per variant stack (project `<projectName>_default`), during each load stage:

- **Containers:** `docker compose ps --format json` → `Id` + `Service`
  (one call, gives the id→role map). Sample the stack's own services —
  `app` / `api` / `spa` / `db` — and the `bench-k6-*` generator (it is in
  the project network and its CPU is already a recorded metric; getting it
  from the same pass is free). Exclude one-shot `bench-seeder` runs.
- **Cadence:** ~1 Hz, aligned with the existing loop in `runK6Container`.
  One-shot Engine API requests per container; each response carries
  `precpu_stats`, so a single request yields CPU rate without waiting a
  sampling interval.
- **Window:** sampler starts just before the k6 container is created and stops
  after `docker wait` returns — so the series covers exactly the leg being
  measured, per leg (and per capacity step).

### 3.2 The math (computed by us, from raw counters)

- Cores in use = `(cpu.total_usage − precpu.total_usage) / (cpu.system_usage − precpu.system_usage) × online_cpus`.
- **Percent of envelope** = cores in use / the effective `resources:` cap for that service × 100. The caps are already in `LifecycleOptions.resources` and recorded in `effective-config.yaml`, so the denominator is provenance-safe. This — not host-relative percent — is the number that answers "did it max out two CPUs".
- Memory working set ≈ `memory.usage − inactive_file` (cgroup v2; `total_inactive_file` on v1) — same approximation the `docker stats` CLI makes; page cache otherwise flatters RAM numbers.
- Memory percent of envelope = working set / the service's memory cap × 100.
- **OOM kills** = delta of `memory_stats.events.oom_kill` across the leg (cgroup v2) — a hard, unambiguous "hit the RAM ceiling" signal.

### 3.3 Recorded shapes

Per leg, per variant (all under `results/<run-id>/variants/<id>/`):

- `resources/read-samples.json` — the raw 1 Hz time series
  `{ t, service, cores, cpuPctOfEnv, memWorkingSetMb, memPctOfEnv }`,
  written **gated on `report.keepRawSamples`** (same discipline as render
  samples). Same for `mutations-samples.json` and `capacity/<rate>-samples.json`.
- Aggregates folded into the **existing** per-leg reports (no new top-level files):
  - `load.json` / `LoadReport`: `resources: { app: {maxCpuPctOfEnv, avgCpuPctOfEnv, maxMemMb, maxMemPctOfEnv}, db: {…}, oomKills }`
  - `mutations-summary.json` / `MutationReport`: same shape
  - `capacity/<rate>.json` / `CapacityStepReport`: same shape — **per step**, which is the point: the ladder then reads as "20 rps: app 61 % CPU / 40 % RAM → 40 rps: app 99 % CPU, p95 4×, dropped iterations — tipped CPU-bound".

### 3.4 Measurement, not gate (an explicit distinction)

A container pinned at ~100 % of its envelope is a **result**, not a validity
failure. The existing saturation machinery _withholds_ throughput numbers when
the **generator** saturates ("a saturated generator measures itself") — that
rule is untouched. An app that saturates its own envelope is the benchmark
working as designed; the number is recorded loudly, and the tip-over fact in the
compare view names the binding resource. Conversely: a capacity step where the
app _never_ exceeds ~30 % of envelope while p95 still degrades is the
"not CPU-bound" fact — equally valuable.

## 4. Work items

- **U1 — Sampler module** `src/controller/sampler.ts`: socket discovery
  (`DOCKER_HOST`, else default socket path), one-shot stats fetch, id→service
  role map via `compose ps --format json`, start/stop 1 Hz loop, series
  accumulation. Stdlib only. CLI fallback path (§2) with `source` recorded.
- **U2 — Counter math** as pure functions (cores, percent-of-envelope, working
  set, OOM delta) in the same module — the unit-test surface (§5).
- **U3 — Wire into the legs**: `runLoadSuite`, `runMutationSuite`, and
  `runCapacitySuite` (sampler around each step's `runK6Container` call);
  extend `LoadReport` / `MutationReport` / `CapacityStepReport` in
  `src/controller/types`-style declarations inside `lifecycle.ts`; write series
  (gated on `report.keepRawSamples`) + aggregates into existing reports. The
  generator's own CPU continues to come from the same pass (existing
  `generatorMaxCpuPercentObserved` fields stay, now derived from the shared
  series — consolidation, not a behaviour change).
- **U4 — Reporting**: decision-matrix columns (`appMaxCpuPctOfEnv`,
  `appMaxMemPctOfEnv` at the highest sustained step) in `src/reporting/matrix.ts`;
  viewer Run view gains CPU%/RAM% over-time charts per leg; the Compare view's
  per-metric tip-over facts gain a **binding-resource fact** ("tipped at 40 rps,
  app CPU 99 % of envelope, RAM 41 %" / "tipped RAM-bound, OOM ×2"). Blank when
  absent, never zero; backward-compatible with old runs (fields optional).
- **U5 — Docs**: rig README measurement-stage table, `load/README.md` "How the
  controller runs them", and the methodology docs get the new metric and its
  units (percent **of envelope**, not of host).
- **U6 — (stretch, separate decision)** sample the render stage too (SSR is
  CPU-heavy; a CPU-per-render cost is a natural follow-on), and/or add block/net
  IO counters. Not required for the load-testing goal; do not bundle.

No config changes required; no new npm dependencies.

## 5. Testing

- Unit tests (the rig's own suite runs without Docker): U2 math against
  fixture Engine-API JSON (both cgroup v1/v2 shapes, zero-delta first sample,
  OOM delta); series→aggregate folding; old-artefact tolerance for U4.
- Manual smoke: `pnpm rig:run --config config/small-1c1g.yaml` — verify
  `resources/*-samples.json` and the aggregate fields land and the viewer
  renders them; one matrix cell (`pnpm rig:matrix --loads small --envelopes 2c2g`)
  for the compare-view facts.
- `pnpm typecheck`, `pnpm test`.

## 6. Non-goals

- Host/VM-level metrics — the rig limits containers and never resizes the host
  (unchanged); Docker Desktop's VM internals stay out of scope.
- k6 Cloud, Prometheus/Grafana, or any external metrics pipeline (§2).
- Per-process / in-container breakdowns (which route, which runtime thread).
- Network-IO / disk-IO metrics in v1 (trivially available from the same API
  later if wanted — U6).
- Changing the generator-saturation withholding rule (§3.4).

## 7. Honest limitations

- **Observer effect ~zero, and why.** No agent or code inside the containers;
  the sampler is a host-side poller reading cgroup counters the kernel already
  maintains (cgroup accounting is already active — it is what enforces the
  envelope caps). Polling costs the Docker daemon microseconds per tick and
  never sits in the k6→app request path. Residual caveat: everything shares the
  host, so on a _fully_ saturated machine the poller competes like any other
  host process — no worse than the `docker stats`/`inspect` processes the
  generator loop already spawns each second today.

- **1 Hz samples miss sub-second spikes.** Fine for sustained stages
  (capacity steps are 60 s; the read leg is closed-loop for ≥15 s); the numbers
  are _envelope-pressure_ facts, not microburst analysis.
- **macOS caveat:** containers run inside the Docker Desktop Linux VM; the
  envelope caps are enforced inside that VM, and these stats measure cgroup
  usage inside it — consistent with every other measurement the rig takes.
- **CLI fallback is ambiguous** about CPU% normalization (§2); artefacts record
  their `source` so a fallback-sourced number can be read with appropriate
  suspicion.
- **Working set is an approximation** (usage minus inactive page cache);
  it errs on the honest side (understates free-able cache as usage).
