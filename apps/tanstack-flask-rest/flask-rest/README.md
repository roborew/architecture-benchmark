# flask-rest

The REST API variant of the architecture benchmark, rebuilt from the sibling
`express-rest` variant: Flask 3 + psycopg2 against the canonical PostgreSQL
schema (`spec/schema.sql`), serving the sibling `tanstack-rest` SPA (one
directory up). Every read mirrors the reference variant's queries
(`apps/tanstack-start-react/src/lib/data.ts`) and every write mirrors its
actions (`actions.ts`) — statement for statement, message for message.

## Run

```
source .venv/bin/activate         # Flask 3.1 + psycopg2-binary + pytest
echo 'POSTGRES_URL=postgresql://robo@localhost:5432/architecture_tanstack_flask_rest' > .env
python -m src.db.migrate          # apply spec/schema.sql
python -m src.db.seed             # seed the dev fixture (profile "small")
python -m src.server              # http://localhost:4000
```

`python -m pytest tests/unit` needs nothing else; `python -m pytest` creates
and drops its own isolated database (`architecture_tanstack_flask_rest_e2e`,
see `tests/integration/conftest.py`) and never touches the dev database.
`python -m src.db.seed medium` (or `SEED_PROFILE=medium`) loads a different
`spec/snapshots/<profile>` fixture.

The port comes from `PORT` (default 4000, the one the SPA's `VITE_API_URL`
defaults to). `python -m src.server --reload` restarts on file changes. The
module-level `app` in `src/server.py` is also a WSGI entry point —
`gunicorn src.server:app` for a production server.

## Architecture

Layered per domain (`src/<domain>/`), the same layers as the express variant
in Flask's idiom:

| Layer                              | File                     | Knows                                                           |
| ---------------------------------- | ------------------------ | --------------------------------------------------------------- |
| model                              | `<domain>/model.py`      | SQL (psycopg2), nothing HTTP                                    |
| controller                         | `<domain>/controller.py` | the request's meaning, no SQL, no Flask                         |
| routes (the one Flask-aware layer) | `<domain>/routes.py      | reads the request, jsonifies the controller's (status, payload) |
| validator                          | `<domain>/validator.py   | pure input rules, unit-testable without Flask                   |

`src/app.py` is the composition root (the Flask application-factory pattern):
connection → models → controllers → blueprints, wired there and nowhere else.
Every dependency is injected at construction, so any layer is testable with a
fake of the layer below — the controller unit suites run with stub models and
no Flask at all, and `create_app(postgres_url=...)` points the whole stack at
a database of the caller's choosing.

Controllers decide successes by returning `(status, payload)` and raise
`HttpError` for every non-2xx outcome; `src/middleware/error_handler.py`
maps the raise onto the JSON envelope, so an API client never sees HTML.
`src/middleware/cors.py` is the reflected-origin CORS contract
(`cors({ origin: true })` in the express variant) as an `after_request` hook
plus preflight handling.

Shared, framework-free pieces live in `src/lib/`: the keyset cursor
(`cursor.py`, byte-identical to the express variant's — unpadded base64url of
`created_at|id`), the shared task row projection (`task_projection.py`), the
zod-parity validation primitives (`validation.py` — the reference's message
strings are part of the API contract), the query/route param validators
(`query_validator.py`), the body-parser-equivalent JSON body reader
(`body.py`), and the `HttpError` type (`http_error.py`).

## API surface

Identical to the express variant's — the SPA (`tanstack-rest/src/api/`)
consumes both unchanged. See that variant's README for the full table; in
brief: `GET /healthz`, `/api/users`, `/api/users/:id`, `/api/users/:id/tasks`,
`/api/projects`, `/api/projects/:id`, `/api/projects/:id/tasks`,
`/api/tasks`, `/api/tasks/count`, `/api/tasks/:id`, `/api/tasks/:id/comments`,
`/api/dashboard`, and the POST/PATCH/DELETE writes with the reference's
`{ ok, message, redirectTo }` success envelopes and `{ error, errors? }`
failure envelopes (message strings verbatim from the reference's zod
schemas).

## Differences from the express variant

Deliberate, and each documented where it happens:

- **Method mismatches answer 404, not 405** — the express variant has no
  method matching, so a wrong-method request falls through to its not-found
  middleware; the error handler mirrors that.
- **The dashboard's three queries run in sequence**, not `Promise.all` —
  same statements, same response shape, no observable ordering difference.
- **`limit` clamping, cursor decoding, and JS `Number()` coercions** are
  reproduced exactly (including `Number(null) === 0` feeding zod's "Too
  small: expected number to be >0"), so a body the reference accepts is
  accepted here with the same messages.
