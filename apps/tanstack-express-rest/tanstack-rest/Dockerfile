# syntax=docker/dockerfile:1
#
# vite-spa-static archetype (plan §3.3): build the SPA, then serve the static
# assets from the shared, pinned `caddy:2-alpine` image with history-mode
# fallback. The API base URL is baked in at build time via the VITE_API_URL
# build arg (the rig allocates the API port and passes it here).

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm build

FROM caddy:2-alpine AS runtime
COPY --from=build /app/dist /usr/share/caddy
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
