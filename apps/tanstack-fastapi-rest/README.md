# tanstack-fastapi-rest

A `spa-api` benchmark pair: the `fastapi-rest` API (FastAPI + psycopg 3, served
by uvicorn) and the `tanstack-rest` SPA (TanStack Router + React, built with Vite
and served as static assets). One `compose.yaml` at this root orchestrates both
halves plus the shared `db` and the rig-owned `seeder`.

| Directory        | Role                      |
| ---------------- | ------------------------- |
| `fastapi-rest/`  | API (see its `README.md`) |
| `tanstack-rest/` | SPA (see its `README.md`) |

## Run in Docker

```bash
# Build and start the stack (API on 4015, SPA on 3015 by default).
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

- **API** — published as `${API_PORT:-4015}` → container `:4000`, health at
  `/healthz`. `python-api` archetype (plan §3.3): multi-stage, production mode,
  non-root (`appuser`). Python pinned to 3.13 (`requires-python = ">=3.13"`);
  dependencies installed from `pyproject.toml` (no lockfile).
- **SPA** — published as `${SPA_PORT:-3015}` → container `:80`, health at `/`.
  `vite-spa-static` archetype: built with Vite and served by the shared pinned
  `caddy:2-alpine` image. `VITE_API_URL` (`${VITE_API_URL:-http://localhost:4015}`)
  is baked in at build time, so changing the API port requires a rebuild.
- **db** — `postgres:17-alpine`, never published to the host; reached in-stack at
  `postgresql://bench:bench@db:5432/bench`. The API reads that URL directly as
  `POSTGRES_URL` (`app/config.py`), so no alias is needed.
- **CORS** — the API reflects the request origin (`app/main.py`:
  `allow_origin_regex=".*"`), so `CORS_ORIGIN` is informational here.

### API server choice (recorded as required)

The production ASGI server is **uvicorn**, bound to `0.0.0.0:4000`, loading the
app factory:

```
uvicorn app.main:create_app --factory --host 0.0.0.0 --port 4000 --workers 2
```

- **2 workers** — one per CPU of the rig's 2-CPU cap; each worker runs its own
  event loop and owns its own `AsyncConnectionPool` (`app/db/connection.py`,
  `min_size=1`, `max_size=10`).
- **`--factory`** — `create_app` is the composition root (`app/main.py`); the
  pool opens in the app's lifespan, so importing the module never binds a socket.
- **Event loop** — uvicorn's default (`auto` → **asyncio**; `uvloop` is not a
  dependency), leaving the async I/O model as the variant's variable.
