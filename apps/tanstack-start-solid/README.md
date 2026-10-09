Welcome to your new TanStack Start app!

# Getting Started

To run this application:

```bash
npm install
npm run dev
```

# Building For Production

To build this application for production:

```bash
npm run build
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Remove `@tailwindcss/vite` and `tailwindcss` from `package.json`

## Deploy with Nitro

This project uses Nitro as a generic server adapter, so it can run on any Node-compatible host.

```bash
npm run build
node dist/server/index.mjs
```

The build output is a self-contained Node server. To deploy, push the `dist/` directory to your host (Render, Fly.io, your own VPS, etc.) and run the server command above.

For host-specific presets (Vercel, Netlify, Cloudflare, AWS Lambda, etc.) and tuning, see https://v3.nitro.build/deploy.

## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/solid-router`.

```tsx
import { Link } from "@tanstack/solid-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/solid/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes.

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/solid/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from "@tanstack/solid-start";

const getServerTime = createServerFn({
  method: "GET",
}).handler(async () => {
  return new Date().toISOString();
});
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/people")({
  loader: async () => {
    const response = await fetch("https://swapi.dev/api/people");
    return response.json();
  },
  component: PeopleComponent,
});

function PeopleComponent() {
  const data = Route.useLoaderData();
  return (
    <ul>
      <For each={data().results}>{(person) => <li>{person.name}</li>}</For>
    </ul>
  );
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/solid/guide/data-loading#loader-parameters).

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:

```bash
npm run lint
npm run format
npm run check
```

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).

## Run in Docker

`Dockerfile`, `compose.yaml`, `.dockerignore` and `.env.example` package this
variant as one self-contained benchmark stack (`db` + `seeder` + `app`) — the
`tanstack-start` archetype from `docs/testing-rig-final-implementation-plan.md`
§3.3: `vite build` emits a self-contained Node server under `.output/`, run with
`node .output/server/index.mjs`. The image is multi-stage, production mode, and
runs as a non-root user; it is built with pnpm, matching `pnpm-lock.yaml`.
Postgres is never published; the app reaches it in-network at
`postgresql://bench:bench@db:5432/bench`.

For a manual run:

```bash
cp .env.example .env                 # APP_PORT=3002 by default
docker compose up --build -d
curl -fsS http://localhost:3002/healthz

# load the canonical fixture through the rig-owned seeder image
# (build it once from the repo root: docker build -t bench-seeder:local testing-rig/seeder)
docker compose run --rm seeder seed small

docker compose down -v               # leaves nothing behind
```

The benchmark rig owns the real invocation: it allocates `APP_PORT` and the
`APP_CPUS` / `APP_MEMORY_MB` / `DB_CPUS` / `DB_MEMORY_MB` caps per run, sets a
run-unique Compose project name (`bench-tanstack-start-solid-<runId>`), and
drives the seeder's `seed` / `reset` / `verify` modes itself. The values in
`.env.example` are only the defaults for a manual `docker compose up`.
