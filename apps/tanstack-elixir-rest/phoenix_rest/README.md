# phoenix_rest

The REST API variant of the architecture benchmark: Phoenix 1.8 + Ecto/Postgrex
against the canonical PostgreSQL schema (`spec/schema.sql`), serving the sibling
`tanstack-rest` SPA (one directory up) on `http://localhost:4000`. Every read
mirrors the reference variant's queries
(`apps/tanstack-start-react/src/lib/data.ts`) and every write mirrors its actions
(`actions.ts`) — statement for statement, message for message.

## Run

```
mix deps.get
mix ecto.setup    # create the dev DB, apply spec/schema.sql, seed the "small" profile
mix phx.server    # http://localhost:4000
```

`mix test` creates its own test database (`phoenix_rest_test`), applies
`spec/schema.sql`, and runs the suite; a SQL sandbox rolls every test back, so the
dev database is never touched.

The schema is **not** managed by Ecto migrations: `spec/schema.sql` is normative
and applied directly, so dev and test databases cannot drift. `mix phx.rest.schema`
drops and reapplies it, and is wired into both the `test` and `ecto.setup` aliases.

## Architecture

Layered per domain: the context — `PhoenixRest.Users`, `PhoenixRest.Projects`,
`PhoenixRest.Tasks`, `PhoenixRest.Dashboard` in `lib/phoenix_rest/` — is the only
place that knows SQL; the controller
(`lib/phoenix_rest_web/controllers/<domain>_controller.ex`) validates the request
and writes the response (Plug types, no SQL); and the pure validators
(`lib/phoenix_rest/<domain>/validator.ex`) hold the reference's zod rules and
message strings verbatim, so a client that rendered the reference app's
validation errors renders these unchanged.

A controller returns `{:error, %PhoenixRestWeb.ApiError{}}` for every non-2xx
outcome, and `PhoenixRestWeb.FallbackController` writes it as `put_status/2` +
`json/2` — the JSON error envelope is described in exactly one place, the
controller that decided it. `PhoenixRestWeb.Plugs.CORS` reflects the SPA's origin
and answers preflights before the router (a preflight `OPTIONS` would otherwise
404).

Shared, framework-free pieces live in `lib/phoenix_rest/`: the keyset cursor
(`cursor.ex`, ported from the reference), the shared task row projection
(`task_projection.ex`, so three surfaces cannot render one task two ways), the
`?`→`$n` SQL fragment accumulator (`sql.ex`), and the query-param validators
(`query_params.ex`, which reads the raw query string Express-style so a repeated
param is rejected rather than collapsed). `PhoenixRest.Repo.query_maps/2` turns a
Postgrex result into the string-keyed wire rows the SPA renders, and
`PhoenixRest.Spec` / `PhoenixRest.Seed` locate and load `spec/`.

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
| `POST /api/tasks/with-comment` `{ …task, commentBody, commentAuthorId }`   | ONE transaction (`Repo.transaction`): either the task and its first comment both exist, or neither                                  |
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
