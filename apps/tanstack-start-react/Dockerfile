# syntax=docker/dockerfile:1
#
# tanstack-start archetype (plan §3.3): `vite build` (TanStack Start + nitro)
# emits a self-contained Node server under `.output/`, which the runtime stage
# runs directly. Build context is this directory only.
#
# This variant is locked with npm (package-lock.json), so the build uses npm
# rather than pnpm. Every route is request-time SSR and the query layer opens the
# Postgres client lazily (src/lib/db.ts), so `vite build` needs no database — the
# build-stage POSTGRES_URL placeholder only satisfies module evaluation. The
# schema and data arrive later via the rig's seeder service.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Placeholder for module evaluation only; the stack injects the real URL at runtime.
ENV POSTGRES_URL=postgresql://bench:bench@127.0.0.1:5432/bench
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S app -u 1001 -G nodejs
# nitro bundles every runtime dependency into `.output` (only `node:*` builtins
# stay external), so no source `node_modules` is copied — the smallest correct image.
COPY --from=build --chown=app:nodejs /app/.output ./.output
USER app
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
