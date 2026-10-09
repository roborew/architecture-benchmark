# fastapi-rest

The REST API variant of the architecture benchmark: FastAPI + psycopg 3
against the canonical PostgreSQL schema (`spec/schema.sql`), serving the
sibling `tanstack-rest` SPA (one directory up). Every read mirrors the
reference variant's queries (`apps/tanstack-start-react/src/lib/data.ts`) and
every write mirrors its actions (`actions.ts`) — statement for statement,
message for message. It is a port of the `express-rest` variant
(`apps/tanstack-express-rest/express-rest`): the REST surface, the JSON
envelopes and every message string are identical, verified response-for-
response against it.

## Run

```
python -m venv .venv
.venv/bin/pip install -e . --group dev   # or: pip install fastapi 'psycopg[pool]' uvicorn pydantic-settings pytest
echo 'POSTGRES_URL=postgresql://…' > .env
createdb architecture_tanstack_fastapi_rest     # once; the db scripts assume it exists
.venv/bin/python -m app.db.migrate              # apply spec/schema.sql
.venv/bin/python -m app.db.seed                 # seed the dev fixture ("small")
.venv/bin/python -m uvicorn app.main:create_app --factory --port 4000 --reload
```

`.venv/bin/python -m pytest tests/unit -q` needs nothing else; `.venv/bin/
python -m pytest tests/integration -q` (or plain `pytest`) creates and drops
its own isolated database (`architecture_tanstack_fastapi_rest_e2e`, see
`tests/helpers/database.py`) and never touches the dev database. The browser
suite lives in the sibling `tanstack-rest` (`pnpm test:e2e` — Playwright
starts this API via `uvicorn app.main:create_app --factory` plus the Vite dev
server, against the same isolated database).

## Architecture

Layered per domain (`app/<domain>/`): `<domain>/model.py` is the only place
that knows SQL, `<domain>/controller.py` validates the request and decides the
outcome (raw query/body bags in, response payloads out; no SQL, no FastAPI),
`<domain>/routes.py` maps the REST surface onto controller calls with
`APIRouter` (no SQL, no validation logic), `<domain>/validator.py` holds pure
body validation (unit-testable without FastAPI), and `<domain>/schemas.py`
holds the pydantic response models whose aliases spell the camelCase keys the
SQL projection returns. `app/main.py` is the composition root: pool → models
→ controllers → routers, wired there and nowhere else. The pool opens in the
app's lifespan and closes on shutdown; importing the app never opens a
socket, and `uvicorn app.main:create_app --factory` is the only entry that
listens.

Shared, framework-free pieces live in `app/lib/`: the keyset cursor
(`cursor.py`, ported from the reference), the shared task row projection
(`task_projection.py`, SQL fragments every task read interpolates so the
surfaces cannot drift apart), the `ApiError` controllers raise for every
non-2xx outcome (`http_error.py`, mapped to its JSON envelope by the
exception handlers in `app/errors.py`), the query-param validators
(`query_validator.py`), and the zod-mirror field primitives (`fields.py`) —
the reference's message strings, reproduced exactly, including zod's own type
messages ("Invalid input: expected string, received null").

## API surface

### Reads

| Endpoint                                                          | Result                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /healthz`                                                    | `{ ok: true }`                                                                                |
| `GET /api/projects?q=`                                            | `Project[]` — aggregates + `createdAt` (date-only), `created_at DESC, id DESC`                |
| `GET /api/projects/:id`                                           | `Project` · 404 `{ error: "Not found" }`                                                      |
| `GET /api/projects/:id/tasks?status=&cursor=&limit=`              | `ProjectTaskRow[]` — newest first (`created_at DESC, id DESC`), keyset-paged                  |
| `GET /api/tasks?q=&status=&projectId=&assigneeId=&cursor=&limit=` | `TaskRow[]` — `updated_at DESC, id DESC`, keyset-paged, default limit 25 (clamped to [1, 26]) |
| `GET /api/tasks/count?q=&status=&projectId=&assigneeId=`          | `{ count }`                                                                                   |
| `GET /api/tasks/:id`                                              | `TaskWithProject` (incl. `projectName`) · 404 when missing                                    |
| `GET /api/tasks/:id/comments`                                     | `Comment[]` — the 10 most recent, newest first                                                |
| `GET /api/users?q=`                                               | `User[]` — `display_name DESC, id DESC`                                                       |
| `GET /api/users/:id`                                              | `User` · 404 when missing                                                                     |
| `GET /api/users/:id/tasks`                                        | `TaskWithProject[]` — scoped by `assignee_id`, `updated_at DESC, id DESC`                     |
| `GET /api/dashboard`                                              | `{ stats, recentTasks (3), projects (2) }` — projects ordered by task count DESC, id ASC      |

Paged rows carry the raw cursor components (`createdAtRaw` on board rows,
`updatedAtRaw` on workspace rows) and a ready `cursorFor` — the opaque
`(created_at|updated_at, id)` tuple the next page starts after. Pass it back
as `?cursor=`; an unusable cursor simply yields the first page (mirroring the
reference's `decodeCursor`).

An unknown `status` filter answers `400 { error: "Unknown task status: …" }`
(the reference's thrown message).

### Writes

Success: `201` for creates, `200` for updates/deletes →

```json
{ "ok": true, "message": "…", "redirectTo": "…" }
```

Validation failure: `400` →

```json
{ "error": "…", "errors": { "<field>": ["…"] } }
```

— the field→messages maps and every message string are the reference variant's
zod schemas verbatim (e.g. `"Missing fields. Failed to create task."`, `"Title
is required."`, `"Choose a valid status."`). Unknown row on update/delete:
`404 { error }` with the reference's message (e.g. `"That task no longer
exists."`). FK RESTRICT guards: `409 { error }` with the reference's guard
message verbatim.

| Endpoint                                                                   | Notes                                                                                                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/projects` `{ name, description }`                               | `redirectTo /projects/:id`                                                                                                          |
| `PATCH /api/projects/:id`                                                  | `redirectTo /projects/:id` · 404 when missing                                                                                       |
| `DELETE /api/projects/:id`                                                 | `redirectTo /projects` · 409 while the project still has tasks                                                                      |
| `POST /api/users` `{ name, email }`                                        | `redirectTo /users/:id`                                                                                                             |
| `PATCH /api/users/:id`                                                     | `redirectTo /users/:id` · 404 when missing                                                                                          |
| `DELETE /api/users/:id`                                                    | `redirectTo /users` · 409 while the member has comments                                                                             |
| `POST /api/tasks` `{ projectId, assigneeId?, title, description, status }` | `redirectTo /tasks/:id`; unknown project/assignee are field errors                                                                  |
| `PATCH /api/tasks/:id` `{ title, description, status, assigneeId }`        | `redirectTo /tasks/:id` · 404 when missing; `assigneeId: null` unassigns; `updated_at` advanced explicitly                          |
| `DELETE /api/tasks/:id`                                                    | `redirectTo /projects/:projectId` of the deleted task; comments cascade                                                             |
| `POST /api/tasks/with-comment` `{ …task, commentBody, commentAuthorId }`   | ONE transaction (one pool connection block): either the task and its first comment both exist, or neither                           |
| `POST /api/tasks/:id/comments` `{ body, authorId }`                        | `201 { ok: true }` — no `redirectTo`/`message`, mirroring the reference's `createComment` reply (the user stays on the detail page) |

### Response-shape decisions (no reference string exists)

The reference's actions return no success message (only `redirectTo`), so the
success `message` strings ("Task created.", "Project updated.", …) are this
API's own, in the reference's voice; the `redirectTo` targets follow the REST
contract above (creates redirect to the new row's page, so a persisted id is
always allocated and returned). Comment errors are keyed by the request's own
field names (`body`/`authorId` on the standalone endpoint,
`commentBody`/`commentAuthorId` on with-comment); the with-comment author
error is keyed `assigneeId` exactly as the reference keys it.

### Deviations from the Express variant

None on the wire — the two apps were diffed response-for-response on every
endpoint (reads, error envelopes, and the full write matrix) against the same
seeded database, with byte-identical results. The only deliberate difference
is invisible: a wrong-method request on a known path answers Starlette's 405
`{ error: "Method Not Allowed" }` where Express's fall-through answered 404
`{ error: "Not found" }` — no client of this API issues wrong-method requests.
