# syntax=docker/dockerfile:1
#
# node-api archetype (plan §3.3), Fastify 5 variant. Node 24 runs the
# TypeScript entry directly (stable type stripping; the app is written
# `erasableSyntaxOnly`), so there is no `tsc` step — the image ships source.

FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 4000
CMD ["node", "src/server.ts"]
