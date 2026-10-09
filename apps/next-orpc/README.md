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

This app ships as a self-contained Compose stack: a pinned Postgres 17 instance
(to read), the rig-owned one-shot `bench-seeder` fixture loader, and the
production app image (Next.js standalone output, non-root, no dev dependencies).

```bash
# Build and start db + app (published on ${APP_PORT:-3002}).
docker compose up --build -d

# Load the benchmark fixture (build the shared seeder image once per host).
docker build -t bench-seeder:local ../../testing-rig/seeder
docker compose run --rm seeder seed small

# Tear everything down, including the volume.
docker compose down -v
```

Configuration comes from the environment (see `.env.example`); the defaults are
sane for a manual run. The app reaches Postgres only over the stack network at
`postgresql://bench:bench@db:5432/bench`; the database port is never published.
The `/healthz` route reports readiness and backs the Compose healthcheck.
