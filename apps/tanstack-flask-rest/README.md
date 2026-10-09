# tanstack-flask-rest

A `spa-api` benchmark pair: the `flask-rest` API (Flask 3 + psycopg2, served by
gunicorn) and the `tanstack-rest` SPA (TanStack Router + React, built with Vite
and served as static assets). One `compose.yaml` at this root orchestrates both
halves plus the shared `db` and the rig-owned `seeder`.

| Directory        | Role                      |
| ---------------- | ------------------------- |
| `flask-rest/`    | API (see its `README.md`) |
| `tanstack-rest/` | SPA (see its `README.md`) |

## Run in Docker

```bash
# Build and start the stack (API on 4014, SPA on 3014 by default).
docker compose up -d --build

# Load the canonical fixture, then verify it reproduces the golden digest
# (build the seeder once from the repo root: docker build -t bench-seeder:local testing-rig/seeder).
docker compose run --rm seeder seed
docker compose run --rm seeder verify

# Tear everything down, including the database volume.
docker compose down -v
```

Ports, the SPA's baked-in API URL, resource caps and the CORS origin are all
environment-driven (see `.env.example`); copy it to `.env` to override the
defaults for a manual run. The rig sets these itself per run.

- **API** — published as `${API_PORT:-4014}` → container `:4000`, health at
  `/healthz`. `python-api` archetype (plan §3.3): multi-stage, production mode,
  non-root (`appuser`). Python pinned to 3.13; dependencies installed from
  `pyproject.toml` (no lockfile).
- **SPA** — published as `${SPA_PORT:-3014}` → container `:80`, health at `/`.
  `vite-spa-static` archetype: built with Vite and served by the shared pinned
  `caddy:2-alpine` image. `VITE_API_URL` (`${VITE_API_URL:-http://localhost:4014}`)
  is baked in at build time, so changing the API port requires a rebuild.
- **db** — `postgres:17-alpine`, never published to the host; reached in-stack at
  `postgresql://bench:bench@db:5432/bench`. The API reads that URL directly as
  `POSTGRES_URL` (`src/config/env.py`), so no alias is needed.
- **CORS** — the API reflects the request origin (`src/middleware/cors.py`, the
  Flask form of express's `cors({ origin: true })`), so `CORS_ORIGIN` is
  informational here.

### API server choice (recorded as required)

The production WSGI server is **gunicorn**, bound to `0.0.0.0:4000`:

```
gunicorn --bind 0.0.0.0:4000 --workers 2 --threads 4 --worker-class gthread src.server:app
```

- **2 workers** — one per CPU of the rig's 2-CPU cap.
- **gthread, 4 threads/worker** (8 concurrent requests) — the SPA's TanStack
  Query layer fires bursts of parallel fetches and the app's `Db` pool is
  blocking, so threads keep requests in flight instead of serialising them
  behind the (synchronous) WSGI worker. Note this gives each worker its own
  pool of up to 10 connections (2 × 10 = 20 max), which the 2-CPU Postgres
  easily serves.
- **App object** — `src.server:app`, matching the README's `gunicorn
  src.server:app`; the module-level `app = create_app()` in `src/server.py` is
  the documented WSGI entry point.
