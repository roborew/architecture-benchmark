# Load suite (plan §6.5)

`read.js` is a k6 script. The controller runs it in the pinned `grafana/k6`
image **on the stack network**, targeting the variant's read paths.

This is the **interim, read-only** measurement the plan allows until
per-transport write adapters are validated against a captured browser request:
a read-capacity figure, labelled, with no mutation-capacity claim.

## How the controller runs it (`--with-load`)

- Target service comes from the manifest's `load: { service, paths }` (app for
  single-service variants, api for `spa-api`).
- `docker run -d --name bench-k6-<id> --network <project>_default
  --add-host host.docker.internal:host-gateway … grafana/k6 run …`; the script
  reaches the published port via `host.docker.internal` (Docker Desktop is the
  supported host).
- The generator's CPU is sampled with `docker stats` while it runs; a run whose
  generator exceeds `load.generatorMaxCpuPercent` is marked **saturated** and its
  number is withheld from the matrix (a saturated generator measures itself).
- `pg_stat_statements` totals are snapshotted before/after (`delta`).
- Raw output: `results/<run-id>/variants/<id>/{k6.log,load.json,k6-summary.json}`;
  the matrix shows `load_ops_per_sec`.

## Env (set by the controller)

`BASE_URL`, `PATHS` (comma-separated), `VUS`, `DURATION`.

## Known limitations

- **Read-only.** Writes (create/update/delete) need per-transport adapters
  (REST, GraphQL, tRPC, oRPC, Server Actions, server functions), each validated by
  capturing a real browser request — plan §5/§7. Until then only read capacity is
  claimed.
- **GraphQL has no `load` target.** Its read transport is POST-only; a GET
  generator cannot exercise it, so the variant's load cell is blank rather than
  misleading.
- Single host, single generator — indicative; serious saturation needs a separate
  load-generator machine (plan §7).
