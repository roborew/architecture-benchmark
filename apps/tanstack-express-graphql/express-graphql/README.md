# express-graphql

The GraphQL API variant of the architecture benchmark: Express 5 + postgres.js
against the canonical PostgreSQL schema (`spec/schema.sql`), serving the sibling
`tanstack-graphql` SPA (one directory up). GraphQL Yoga serves the schema at
`/graphql`; every read mirrors the reference variant's queries
(`apps/tanstack-start-react/src/lib/data.ts`) and every write mirrors its actions
(`actions.ts`) — statement for statement, message for message.

## Run

```
pnpm install
echo 'POSTGRES_URL=postgresql://…' > .env
pnpm db:reset     # apply spec/schema.sql + seed the dev fixture
pnpm dev          # http://localhost:4000  (GraphiQL at /graphql)
```

`pnpm typecheck` / `pnpm test:unit` need nothing else; `pnpm test:integration`
creates and drops its own isolated database
(`architecture_tanstack_express_rest_e2e`, see `tests/helpers/database.ts`) and
never touches the dev database.

## Architecture

Layered per domain (`src/<domain>/`): `<domain>.model.ts` is the only place that
knows SQL, `<domain>.resolvers.ts` is the domain's slice of the GraphQL surface
(GraphQL types, no SQL), and `<domain>.validator.ts` holds pure validation
(unit-testable without GraphQL).

The transport-level pieces are shared under `src/graphql/`: the SDL
(`type-defs.ts`), the composite schema (`schema.ts`), the typed error factories
(`graphql-error.ts`), the adapters that hand GraphQL-typed arguments to the
validators (`args.ts`), and the masking policy (`masked-errors.ts`). `src/app.ts`
is the composition root: connection → models → resolvers → schema → Yoga, wired
there and nowhere else; `src/health/health.routes.ts` adds the one non-GraphQL
route (`GET /healthz`).

Shared, framework-free pieces live in `src/lib/`: the keyset cursor (`cursor.ts`,
ported from the reference), the shared task row projection
(`task-projection.ts`), and the query-argument validators
(`query.validator.ts`).

## API surface

One endpoint, `POST /graphql`, carrying `{ query, variables }`. The SDL
(`src/graphql/type-defs.ts`) is the source of truth; the tables below mirror it.

### Query

| Field                                                              | Result                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `dashboard`                                                        | `Dashboard!` — stats, the 3 most recent tasks, the 2 busiest projects (task count DESC, id ASC) |
| `projects(q: String)`                                              | `[Project!]!` — aggregates + `createdAt` (date-only), `created_at DESC, id DESC`                |
| `project(id: Int!)`                                                | `Project!` · NOT_FOUND when missing                                                             |
| `projectTasks(projectId: Int!, status, cursor, limit)`             | `[ProjectTaskRow!]!` — newest first (`created_at DESC, id DESC`), keyset-paged                  |
| `tasks(q, status, projectId: Int, assigneeId: Int, cursor, limit)` | `[TaskRow!]!` — `updated_at DESC, id DESC`, keyset-paged, default limit 25 (clamped to [1, 26]) |
| `taskCount(q, status, projectId, assigneeId)`                      | `Int!` — how many tasks match the list's filters                                                |
| `task(id: Int!)`                                                   | `Task!` (incl. `projectName`) · NOT_FOUND when missing                                          |
| `taskComments(taskId: Int!)`                                       | `[Comment!]!` — the 10 most recent, newest first                                                |
| `users(q: String)`                                                 | `[User!]!` — `display_name DESC, id DESC`                                                       |
| `user(id: Int!)`                                                   | `User!` · NOT_FOUND when missing                                                                |
| `userTasks(userId: Int!)`                                          | `[Task!]!` — scoped by `assignee_id`, `updated_at DESC, id DESC`                                |

Paged rows carry the raw cursor components (`createdAtRaw` on board rows,
`updatedAtRaw` on workspace rows) and a ready `cursorFor` — the opaque
`(created_at|updated_at, id)` tuple the next page starts after. Pass it back as
`cursor`; an unusable cursor simply yields the first page (mirroring the
reference's `decodeCursor`).

An unknown `status` filter answers BAD_INPUT with `"Unknown task status: …"`
(the reference's thrown message).

The `task`/`project`/`user` fields are non-null and throw NOT_FOUND for a
missing row: the REST API answered 404 there, and the SPA's routes branch on
`ApiError.status === 404` to render their inline not-found states, so a missing
row must surface as an error, not as a null field.

### Mutation

Every mutation returns `MutationOutcome!` — `{ ok, message, redirectTo }`, the
REST write envelope verbatim, because the SPA's `useApiAction` reads exactly
those three fields. The mutation _arguments_ are all `String` (nullable): the
SPA's forms submit field bags of strings and the server owns every coercion rule
(the reference's validators), so an empty `assigneeId` means "unassigned".

| Field                                                           | Notes                                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `createProject(name, description)`                              | `redirectTo /projects/:id`                                                                                       |
| `updateProject(id: Int!, name, description)`                    | `redirectTo /projects/:id` · NOT_FOUND when missing                                                              |
| `deleteProject(id: Int!)`                                       | `redirectTo /projects` · CONFLICT while the project still has tasks                                              |
| `createUser(name, email)`                                       | `redirectTo /users/:id`                                                                                          |
| `updateUser(id: Int!, name, email)`                             | `redirectTo /users/:id` · NOT_FOUND when missing                                                                 |
| `deleteUser(id: Int!)`                                          | `redirectTo /users` · CONFLICT while the member has comments                                                     |
| `createTask(projectId, assigneeId, title, description, status)` | `redirectTo /tasks/:id`; unknown project/assignee are field errors                                               |
| `createTaskWithComment(…task, commentBody, commentAuthorId)`    | ONE transaction (`sql.begin`): either the task and its first comment both exist, or neither                      |
| `updateTask(id: Int!, title, description, status, assigneeId)`  | `redirectTo /tasks/:id` · NOT_FOUND when missing; empty `assigneeId` unassigns; `updated_at` advanced explicitly |
| `deleteTask(id: Int!)`                                          | `redirectTo /projects/:projectId` of the deleted task; comments cascade                                          |
| `addTaskComment(taskId: Int!, body, authorId)`                  | `{ ok }` alone — no `message`/`redirectTo`, mirroring the reference's `createComment` reply                      |

The success `message` strings ("Task created.", "Project updated.", …) are this
API's own — the reference's actions return only `redirectTo` — written in the
reference's voice. The `redirectTo` targets follow the same contract as the REST
variant (creates redirect to the new row's page, so a persisted id is always
allocated and returned).

### Errors

GraphQL has no HTTP status line for a handled failure: a deliberate error is
HTTP `200` with `data: null` and the error inside `errors`. The REST envelope is
preserved in the error's fields —

```json
{
  "errors": [
    {
      "message": "Missing fields. Failed to create task.",
      "extensions": {
        "code": "BAD_INPUT",
        "errors": { "title": ["Title is required."] }
      }
    }
  ],
  "data": null
}
```

- `errors[0].message` is the REST envelope's `error` — the reference's message
  verbatim (`"That task no longer exists."`, `"This person still has 2 comments…"`).
- `extensions.code` is the outcome kind: `BAD_INPUT` (400-equivalent, also
  carries the field→messages map under `extensions.errors`), `NOT_FOUND`
  (404-equivalent), or `CONFLICT` (409-equivalent, the FK RESTRICT guards).
- The field→messages maps and every message string are the reference variant's
  zod schemas verbatim (e.g. `"Missing fields. Failed to create task."`,
  `"Title is required."`, `"Choose a valid status."`).

The SPA's api client reverses this mapping: `extensions.code` becomes the
`ApiError.status` its routes branch on (404 → the inline not-found state,
409 → the guard message), and `extensions.errors` becomes the field → messages
map its forms render.

Anything the app did not answer with deliberately — a bug, a database failure a
model rethrew — is masked as `"Internal server error"` (`extensions.code:
"INTERNAL_SERVER_ERROR"`), the same generic line the REST variant's error handler
answered 500s with, so internals never reach the client. The decision is made by
`src/graphql/masked-errors.ts` (duck-typed, not `instanceof`-based, so it holds
under any module loader).
