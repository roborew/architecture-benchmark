// src/middleware/not-found.ts
//
// The fall-through handler. Registered with `app.setNotFoundHandler`, it runs
// for any request that matched no route — Fastify's replacement for the
// middleware the Express variant mounts after every route — so an unmatched
// path answers with the API's JSON error envelope rather than the framework's
// default HTML page. A REST client must never receive HTML.

import type { FastifyReply, FastifyRequest } from "fastify";

export function notFoundHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.status(404).send({ error: "Not found" });
}
