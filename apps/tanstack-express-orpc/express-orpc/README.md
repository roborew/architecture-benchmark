# express-orpc

The oRPC variant of the architecture benchmark: Express 5 + postgres.js against
the canonical PostgreSQL schema (`spec/schema.sql`), serving the sibling
`tanstack-orpc` SPA (one directory up). Every read mirrors the reference
variant's queries (`apps/tanstack-start-react/src/lib/data.ts`) and every write
mirrors its actions (`actions.ts`) — statement for statement, message for
message.

The transport is [oRPC](https://orpc.dev) (contract-first), not REST: one
contract per domain, implemented once, served twice.

## Run

```
pnpm install
echo 'POSTGRES_URL=postgresql://…' > .env
pnpm db:reset     # apply spec/schema.sql + seed the dev fixture
pnpm dev          # http://localhost:4000
```

`pnpm typecheck` / `pnpm test:unit` need nothing else; `pnpm test:run` creates
and drops its own isolated database (`architecture_tanstack_express_orpc_e2e`,
see `tests/helpers/database.ts`) and never touches the dev database.

## Architecture

Contract-first per domain: `src/orpc/contract.ts` declares every procedure —
its input and output schemas and its OpenAPI path metadata — with no logic
inside. `src/orpc/routers/<domain>.ts` implements each contract
(`implement(...)`) with handlers that pass straight through to the models,
reusing the pure validators (`src/<domain>/<domain>.validator.ts`, ported
verbatim from the reference variant's zod schemas). `src/app.ts` is the
composition root: connection → models → routers → handlers, wired there and
nowhere else.

`src/orpc/handlers.ts` builds the two HTTP surfaces one router serves:

| Mount          | Handler          | Serves                                                                                                                                             |
| -------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /rpc/*`  | `RPCHandler`     | the RPC protocol the SPA's client speaks (`RPCLink`, same oRPC version)                                                                            |
| `any /api/*`   | `OpenAPIHandler` | the same procedures as REST, paths from the contracts' OpenAPI metadata, plus the OpenAPI document at `/api/spec.json` and the Scalar UI at `/api` |
| `GET /healthz` | plain Express    | the readiness endpoint the e2e rig waits on                                                                                                        |

Express keeps only the shell: CORS, the JSON body parser, and the 404/500
envelopes for unmatched paths. There are no per-domain Express routes — the
router IS the routing layer, and Express never sees a procedure's name.

The input split mirrors what the REST surface carried, and where: ids the
client already owns are typed values (numbers) — under REST they rode in the
URL; write bodies are the form's field bag (loose optional strings), because
the server owns every normalisation rule. The contract's `.input()` checks
only the SHAPE; the value rules whose messages the reference variant owns
(a blank title, an unknown status) stay in the validators.

Try it:

```
curl localhost:4000/api/users
curl localhost:4000/api/tasks/1
curl localhost:4000/api/spec.json      # the OpenAPI document
open localhost:4000/api                # Scalar UI for the above
```

## API surface

### Reads

| Procedure                   | Result                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `users.list({ q? })`        | `User[]` — aggregates, `display_name DESC, id DESC`                                           |
| `users.byId({ id })`        | `User` · NOT_FOUND `{ error: "Not found" }` when missing                                      |
| `users.tasks({ id })`       | `Task[]` — scoped by `assignee_id`, `updated_at DESC, id DESC`                                |
| `projects.list({ q? })`     | `Project[]` — aggregates + `createdAt` (date-only), `created_at DESC, id DESC`                |
| `projects.byId({ id })`     | `Project` · NOT_FOUND when missing                                                            |
| `projects.tasks({ id, … })` | `ProjectTaskRow[]` — newest first (`created_at DESC, id DESC`), keyset-paged                  |
| `tasks.list({ … })`         | `TaskRow[]` — `updated_at DESC, id DESC`, keyset-paged, default limit 25 (clamped to [1, 26]) |
| `tasks.count({ … })`        | the bare number — a separate aggregate on purpose (spec/queries.md)                           |
| `tasks.byId({ id })`        | `Task` (incl. `projectName`) · NOT_FOUND when missing                                         |
| `tasks.comments({ id })`    | `Comment[]` — the 10 most recent, newest first                                                |
| `dashboard.get()`           | `{ stats, recentTasks (3), projects (2) }` — projects ordered by task count DESC, id ASC      |

Paged rows carry the raw cursor components (`createdAtRaw` on board rows,
`updatedAtRaw` on workspace rows) and a ready `cursorFor` — the opaque
`(created_at|updated_at, id)` tuple the next page starts after. Pass it back
as `cursor`; an unusable cursor simply yields the first page (mirroring the
reference's `decodeCursor`).

An unknown `status` filter rejects with `BAD_REQUEST { error: "Unknown task
status: …" }` (the reference's thrown message).

### Writes

Success resolves to the outcome envelope:

```json
{ "ok": true, "message": "…", "redirectTo": "…" }
```

Validation failure rejects with `BAD_REQUEST` carrying the reference's
field-errors map:

```json
{ "error": "…", "errors": { "<field>": ["…"] } }
```

— in the error's `data`, exactly as the REST 400 body carried it. Unknown row
on update/delete: `NOT_FOUND { error }` with the reference's message (e.g.
`"That task no longer exists."`). FK RESTRICT guards: `CONFLICT { error }`
with the reference's guard message verbatim.

| Procedure                                  | Notes                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `users.create / update / remove`           | `redirectTo /users/:id` (create/update) · `CONFLICT` while the member has comments                                    |
| `projects.create / update / remove`        | `redirectTo /projects/:id` (create/update) · `CONFLICT` while the project still has tasks                             |
| `tasks.create(field bag)`                  | `redirectTo /tasks/:id`; unknown project/assignee are field errors                                                    |
| `tasks.update({ id, field bag })`          | `redirectTo /tasks/:id` · NOT_FOUND when missing; `assigneeId: null`/`""` unassigns; `updated_at` advanced explicitly |
| `tasks.remove({ id })`                     | `redirectTo /projects/:projectId` of the deleted task; comments cascade                                               |
| `tasks.createWithComment(field bag)`       | ONE transaction: either the task and its first comment both exist, or neither                                         |
| `tasks.addComment({ id, body, authorId })` | `{ ok: true }` only — no `redirectTo`/`message`, mirroring the reference's `createComment` reply                      |

Write bodies are the form's field bag: every field a string, present or not,
plus the typed `id` the caller closed over. The value rules and every message
string are the reference variant's zod schemas verbatim (e.g. `"Missing fields.
Failed to create task."`, `"Title is required."`, `"Choose a valid status."`).

### Response-shape decisions (no reference string exists)

The reference's actions return no success message (only `redirectTo`), so the
success `message` strings ("Task created.", "Project updated.", …) are this
API's own, in the reference's voice. Comment errors are keyed by the request's
own field names (`body`/`authorId` on the standalone procedure,
`commentBody`/`commentAuthorId` on with-comment); the with-comment author error
is keyed `assigneeId` exactly as the reference keys it.

## The SPA's half of the contract

The SPA (one directory up) keeps a mirrored copy of `src/orpc/contract.ts` +
`schemas.ts` — the repo has no shared workspace, so the contract travels as a
pair (the same convention the REST variant's row types used). The two files
must move together: a procedure renamed on one side is a compile error there
and a NOT_FOUND on the other.
