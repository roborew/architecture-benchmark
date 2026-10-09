# tanstack-express-graphql

A `spa-api` benchmark pair: the `express-graphql` API (Express 5 + postgres.js +
GraphQL Yoga) and the `tanstack-graphql` SPA (TanStack Router + React, built with
Vite and served as static assets). One `compose.yaml` at this root orchestrates
both halves plus the shared `db` and the rig-owned `seeder`.

| Directory          | Role                                  |
| ------------------ | ------------------------------------- |
| `express-graphql/` | API (see its `README.md`)             |
| `tanstack-graphql/`| SPA (see its `README.md`)             |

## Run in Docker

```bash
# Build and start the stack (API on 4012, SPA on 3012 by default).
docker compose up -d --build

# Load the canonical fixture, then verify it reproduces the golden digest.
docker compose run --rm seeder seed
docker compose run --rm seeder verify

# Tear everything down, including the database volume.
docker compose down -v
```

Ports, the SPA's baked-in API URL, resource caps and the CORS origin are all
environment-driven (see `.env.example`); copy it to `.env` to override the
defaults for a manual run. The rig sets these itself per run.

- **API** — published as `${API_PORT:-4012}` → container `:4000`, health at
  `/healthz`; the GraphQL endpoint is `/graphql` and GraphiQL is enabled.
- **SPA** — published as `${SPA_PORT:-3012}` → container `:80`, health at `/`.
  `VITE_API_URL` (`${VITE_API_URL:-http://localhost:4012}`) is baked in at build
  time, so changing the API port requires a rebuild.
- **db** — `postgres:17-alpine`, never published to the host; reached in-stack at
  `postgresql://bench:bench@db:5432/bench`.
- **CORS** — this API reflects the request origin (`cors({ origin: true })`
  fronting a Yoga instance mounted with `cors: false`), so `CORS_ORIGIN` is
  informational here.

The API image ships source only: Node 24 runs `src/server.ts` directly via type
stripping, so there is no `tsc` step.
