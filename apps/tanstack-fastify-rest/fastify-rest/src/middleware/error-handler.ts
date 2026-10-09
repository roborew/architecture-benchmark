// src/middleware/error-handler.ts
//
// The handler Fastify forwards every failure to. Registered with
// `app.setErrorHandler` in the composition root, it plays the role the
// Express variant's terminal error middleware does — the last middleware in
// the stack — without having to be positioned there by hand: a handler that
// throws or rejects, anywhere in the route tree, lands here.
//
// Two kinds of error arrive here, with different treatment:
//
//   HttpError   an outcome a controller decided on — a 400 validation envelope,
//               a 404 for an unknown row, a 409 FK guard. The payload is the
//               exact JSON the controller chose, so it is passed through
//               untouched and NOT logged: these are expected replies, not
//               failures to diagnose.
//
//   anything else   an unexpected failure (a database error the models
//               rethrow, a bug). Logged once, answered with the generic 500
//               envelope — the internals never reach the client. A malformed
//               JSON body is the one non-HttpError that is still the client's
//               mistake: Fastify's built-in body parser throws it with
//               statusCode 400 (FST_ERR_CTP_INVALID_JSON_BODY, where Express's
//               express.json() threw `entity.parse.failed`), so it is answered
//               as a 400 rather than masquerading as a server fault.

import type { FastifyReply, FastifyRequest } from "fastify";

import { HttpError } from "../lib/http-error.ts";

export function errorHandler(
  error: unknown,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof HttpError) {
    reply.status(error.status).send(error.payload);
    return;
  }

  if ((error as { code?: unknown } | null)?.code ===
    "FST_ERR_CTP_INVALID_JSON_BODY") {
    reply.status(400).send({ error: "Invalid JSON body" });
    return;
  }

  console.error("Unhandled request error:", error);

  reply.status(500).send({ error: "Internal server error" });
}
