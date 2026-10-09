# tanstack-elixir-rest

One variant of the architecture benchmark: the `tanstack-rest` SPA (React 19 +
TanStack Router/Query, built with Vite) paired with the `phoenix_rest` REST API
(Phoenix 1.8 + Ecto/Postgrex, JSON only).

- `tanstack-rest/` — the SPA. Built with Vite, served as static assets by Caddy.
- `phoenix_rest/` — the API. See its own `README.md` for the endpoint surface.
- `compose.yaml` — the whole stack, as driven by the benchmark rig.

## Run in Docker

Four services:

| Service  | Image / build              | Notes                                                                |
| -------- | -------------------------- | -------------------------------------------------------------------- |
| `db`     | `postgres:17-alpine`       | `bench`/`bench`/`bench`; `pg_stat_statements`; **no published port** |
| `seeder` | `bench-seeder:local`       | one-shot, profiles `seed`/`reset`/`verify` (rig-owned image)         |
| `api`    | `phoenix_rest/Dockerfile`  | Phoenix 1.8 + Ecto, prod `mix release`, non-root, `EXPOSE 4000`      |
| `spa`    | `tanstack-rest/Dockerfile` | Vite build served by `caddy:2-alpine`, `EXPOSE 80`                   |

Only `api` and `spa` publish host ports (`API_PORT` → 4000, `SPA_PORT` → 80).
Postgres is reachable only on the Compose network.

### Environment the API needs

The Phoenix app reads its database URL from **`DATABASE_URL`** (see
`phoenix_rest/config/runtime.exs`, prod block). The rig's canonical name is
`POSTGRES_URL`, so `compose.yaml` sets both to the same in-stack URL:

```
DATABASE_URL=postgresql://bench:bench@db:5432/bench
POSTGRES_URL=postgresql://bench:bench@db:5432/bench
```

It also sets:

| Variable          | Value                                  | Why                                               |
| ----------------- | -------------------------------------- | ------------------------------------------------- |
| `SECRET_KEY_BASE` | fixed benchmark constant (see below)   | prod refuses to boot without it                   |
| `PHX_SERVER`      | `true`                                 | a `mix release` only starts the endpoint when set |
| `PHX_HOST`        | `localhost`                            | endpoint URL host                                 |
| `PORT`            | `4000`                                 | Bandit listen port (`EXPOSE 4000`)                |
| `MIX_ENV`         | `prod`                                 | production build/runtime                          |
| `LANG`            | `C.UTF-8`                              | Elixir expects a UTF-8 locale                     |
| `CORS_ORIGIN`     | `http://localhost:3016` (rig-provided) | parity only — see the CORS note below             |

> **`SECRET_KEY_BASE` is a benchmark constant, not a deployment secret.** It is
> a fixed `mix phx.gen.secret`-style value baked into `compose.yaml` and
> `.env.example` so every run of this variant is byte-identical. Do not reuse it
> anywhere real.

### CORS

The API does **not** allowlist origins and does **not** read `CORS_ORIGIN`.
`phoenix_rest/lib/phoenix_rest_web/plugs/cors.ex` reflects the request's
`Origin` header (or `*` when absent) and answers `OPTIONS` preflights before the
router — the equivalent of the reference variant's `cors({ origin: true })`.
`CORS_ORIGIN` is passed by the rig for parity with APIs that do need one.

### Bring the stack up

```sh
# Build images and start db + api + spa.
docker compose up -d --build

# Load the canonical fixture (the rig builds bench-seeder:local first).
docker compose run --rm seeder seed

# Health: GET /healthz → {"ok":true} on the API, HTML on the SPA.
curl -fsS "http://localhost:${API_PORT:-4016}/healthz"
curl -fsS "http://localhost:${SPA_PORT:-3016}/" >/dev/null

docker compose down -v
```

The `api` health route is `GET /healthz` (verified against
`phoenix_rest/lib/phoenix_rest_web/router.ex`), matching the manifest's
`healthPath`.
