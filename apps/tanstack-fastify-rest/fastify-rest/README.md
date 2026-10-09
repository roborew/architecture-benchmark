# fastify-rest

The REST API variant of the architecture benchmark: Fastify 5 + postgres.js
against the canonical PostgreSQL schema (`spec/schema.sql`), serving the sibling
`tanstack-rest` SPA (one directory up). It is a line-for-line counterpart of the
Express variant (`apps/tanstack-express-rest/express-rest`): the same layering,
the same SQL (statement for statement, message for message), the same REST
surface and the same test tiers — only the HTTP framework underneath differs,
so the two variants can be compared on their architectural merits alone.

## Run

```
pnpm install
echo 'POSTGRES_URL=postgresql://…' > .env
pnpm db:reset     # apply spec/schema.sql + seed the dev fixture
pnpm dev          # http://localhost:4000
```

`pnpm typecheck` / `pnpm test:unit` need nothing else; `pnpm test:run` creates
and drops its own isolated database (`architecture_tanstack_fastify_rest_e2e`,
see `tests/helpers/database.ts`) and never touches the dev database.

## Architecture

The same layered shape as the Express variant, per domain
(`src/<domain>/`): `<domain>.model.ts` is the only place that knows SQL,
`<domain>.controller.ts` validates the request and writes the response
(Fastify types, no SQL), `<domain>.routes.ts` maps the REST surface onto
controller calls, and `<domain>.validator.ts` holds pure body validation
(unit-testable without Fastify). `src/app.ts` is the composition root:
connection → models → controllers → routes, wired there and nowhere else.

The framework-free layers are byte-identical to the Express variant — the
models, validators, cursor, projection, `HttpError` and the db scripts port
over unchanged, which is the point: the data layer has no framework coupling.
What differs is only where the framework sits:

| Concern                | Express variant                                        | this variant                                                    |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| composition root       | `createApp()` builds an Express app + middleware chain | `buildApp()` creates a Fastify instance + plugin tree            |
| routing                | `Router()` mounted with `app.use("/api/…", router)`     | `FastifyPluginAsync` registered with `register(routes, { prefix })`, the controller passed in via plugin options |
| route matching         | registration order is the contract (`/count` before `/:id`) | find-my-way matches by specificity — a literal segment always beats a parameter, order is irrelevant |
| request validation     | no schema on routes; zod validators own the messages   | same — Fastify's built-in JSON-Schema validation is deliberately unused so the error envelope stays the reference's, not Fastify's |
| body parsing           | `app.use(express.json())`                             | built in; malformed JSON surfaces as `FST_ERR_CTP_INVALID_JSON_BODY` (statusCode 400) where express.json() threw `entity.parse.failed` |
| error mapping          | terminal `errorHandler` middleware, positioned by hand after every route | `app.setErrorHandler(errorHandler)` — any handler that throws or rejects, anywhere in the tree, lands there; no ordering contract |
| unmatched paths       | `notFound` middleware mounted last                     | `app.setNotFoundHandler(notFoundHandler)`                        |
| CORS                   | `cors({ origin: true })` middleware                    | `@fastify/cors` plugin, same reflection policy                  |
| x-powered-by           | disabled by hand                                      | Fastify never sends it                                          |
| server entry           | `app.listen(port, cb)`; manual `server.close()`        | `await app.listen({ port })` resolves after boot; `app.close()` runs onClose hooks |
| HTTP-level testing     | supertest — a real socket per app                     | `app.inject()` (light-my-request) — requests are dispatched in-process through the route tree; no port is ever bound |

Encapsulation is the structural difference underneath those: Express composes
by mutation (a flat middleware/route stack; every `use` sees the same app),
while Fastify composes by a plugin tree — each `register` creates a scoped
child instance, the prefix belongs to the registration rather than the routes
file, and boot (route compilation, plugin `async` bodies) is deferred until
the first `listen()`/`inject()`/`ready()`.

## API surface

Identical to the Express variant's, statement for statement and message for
message — see `apps/tanstack-express-rest/express-rest/README.md` for the full
endpoint table, error envelopes and response-shape decisions. Both variants
serve the same SPA against the same schema, so any response that differs
between them is a bug in one of them.
