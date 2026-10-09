This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Run in Docker

`Dockerfile`, `compose.yaml` and `.dockerignore` package this variant as one
self-contained benchmark stack (`db` + `seeder` + `app`) — the `next-standalone`
archetype from `docs/testing-rig-final-implementation-plan.md` §3.3. Postgres is
never published; the app reaches it in-network at
`postgresql://bench:bench@db:5432/bench`.

For a manual run:

```bash
cp .env.example .env                 # APP_PORT=3001 by default
docker compose up --build -d
curl -fsS http://localhost:3001/healthz

# load the canonical fixture through the rig-owned seeder image
# (build it once from the repo root: docker build -t bench-seeder:local testing-rig/seeder)
docker compose run --rm seeder seed small

docker compose down -v               # leaves nothing behind
```

The benchmark rig owns the real invocation: it allocates `APP_PORT` and the
`APP_CPUS` / `APP_MEMORY_MB` / `DB_CPUS` / `DB_MEMORY_MB` caps per run, sets a
run-unique Compose project name (`bench-next-drizzle-<runId>`), and drives the
seeder's `seed` / `reset` / `verify` modes itself. The values in `.env.example`
are only the defaults for a manual `docker compose up`.
