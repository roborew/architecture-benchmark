# syntax=docker/dockerfile:1
#
# next-standalone archetype (plan §3.3): multi-stage, production, non-root, no
# dev dependencies in the final image. Build context is this directory only.
#
# Every route is force-dynamic (src/app/layout.tsx), so `next build` needs no
# database; the schema and data arrive later via the rig's seeder service.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# A build only imports the data layer; the postgres client connects lazily, so a
# placeholder satisfies module evaluation without needing a database. The real
# value is injected by the stack at runtime.
ENV POSTGRES_URL=postgresql://bench:bench@127.0.0.1:5432/bench
# Prisma Client is generated code (src/generated/prisma, gitignored), so it must
# exist before `next build` imports it. `prisma generate` reads the schema and
# never contacts the database.
RUN pnpm prisma generate
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
