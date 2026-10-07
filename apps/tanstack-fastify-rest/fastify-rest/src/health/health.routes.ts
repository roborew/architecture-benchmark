// src/health/health.routes.ts
//
// The readiness endpoint. spec/contract.md: `GET /healthz` returns HTTP 200
// with `{"ok":true}` — it may check DB connectivity, must not perform writes.
//
// It deliberately does NOT check connectivity: Playwright starts the web
// server before its global-setup creates the test database, so a healthz that
// touched Postgres would never go ready on a clean machine.

import type { FastifyInstance } from "fastify";

export function mountHealthRoutes(app: FastifyInstance): void {
  app.get("/healthz", async (_request, reply) => {
    reply.status(200).send({ ok: true });
  });
}
