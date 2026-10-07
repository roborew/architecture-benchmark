# tanstack-rest

The TanStack Query + REST variant of the architecture benchmark: a TanStack
Router SPA whose every read and write goes through the sibling `fastify-rest`
API (one directory down) — the browser half of the
`apps/tanstack-fastify-rest/` pair. It is the same example the
`apps/tanstack-express-rest/` pair builds, so the two pairs can be compared on
the backend's architecture alone: this SPA is identical between them, and any
difference a user can see is a difference in the backend.

## Run

```
pnpm install          # in both halves of the pair
cd ../fastify-rest
echo 'POSTGRES_URL=postgresql://…' > .env
pnpm db:reset         # apply spec/schema.sql + seed the dev fixture
pnpm dev              # the API, on http://localhost:4000
cd ..
pnpm dev              # the SPA, on http://localhost:3000
```

The SPA is a separate origin from the API (`VITE_API_URL` overrides where the
fetch client points, defaulting to `http://localhost:4000`); the API reflects
the request origin so every cross-origin fetch the browser makes succeeds.

## Architecture

`src/api/` is how the SPA talks to the server: `api.ts` owns the base URL and
the one `requestJson` every request goes through, where the API's
`{ error, errors? }` envelope becomes an `ApiError`; the per-feature modules
(projects, tasks, users, comments, dashboard) own their endpoints. Mutations
send the form's fields untouched — the server owns every normalisation rule,
so the client cannot disagree with itself about how a value is spelled.

`src/queries/` turns those endpoints into TanStack Query options; the routes'
loaders wire them in with `ensureQueryData` so a page paints with data on
first render, and the components read the same queries through `useQuery`.
`src/lib/types.ts` mirrors the Fastify API's row shapes one for one, because
the API is the contract: a row that differed in shape would make one of the
two wrong about the data.

## Tests

- `pnpm test:run` — the Vitest suite (jsdom, fetch mocked at the requestJson
  boundary): the api layer's URLs and error-envelope parsing, the queries'
  wiring, and every component's rendering, no server needed.
- `pnpm test:e2e` — the Playwright browser suite: real browser, real Fastify
  server, real Postgres. Playwright boots both halves of the pair (the
  `../fastify-rest` webServer on `E2E_API_PORT`, this app's Vite dev server on
  `E2E_WEB_PORT`), and the browser suite runs against its OWN database — the
  same `architecture_tanstack_fastify_rest_e2e` the fastify-rest integration
  suite uses, so both tiers assert against the same shared fixture rows.
  `pnpm test:e2e:ui` for the interactive runner.

The API surface itself — every endpoint, envelope and message string — is
`../fastify-rest/README.md`'s table, including the express↔fastify
architecture comparison.
