# Canonical seeder image — one loader shared by every variant stack (plan §3.2).
#
# Build context is this directory only: no app image and no seeder ever walks
# up to the repo's `spec/`. `schema.sql` and `generate-fixture.mjs` are copies
# of their normative sources; `tests/seeder-sync.test.ts` fails if they drift.
#
# Build (the controller does this, or manually):
#   docker build -t bench-seeder:local testing-rig/seeder

FROM node:22-alpine AS deps
WORKDIR /seeder
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /seeder
ENV NODE_ENV=production
COPY --from=deps /seeder/node_modules ./node_modules
COPY package.json canonical-export.json schema.sql generate-fixture.mjs seed.mjs ./
USER node
ENTRYPOINT ["node", "seed.mjs"]
