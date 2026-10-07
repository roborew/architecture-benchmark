// src/middleware/error-handler.ts
//
// The last middleware in the stack. Express 5 forwards rejections from async
// handlers here automatically; this converts anything that reaches it into the
// API's JSON error envelope, and logs the underlying error once so a production
// failure is diagnosable from the server log without leaking internals to the
// client.
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
//               mistake: express.json() throws it with status 400, so it is
//               answered as a 400 rather than masquerading as a server fault.

import type { ErrorRequestHandler } from "express";

import { HttpError } from "../lib/http-error.ts";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json(error.payload);
    return;
  }

  if (
    (error as { type?: string } | null)?.type === "entity.parse.failed" &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  console.error("Unhandled request error:", error);

  res.status(500).json({ error: "Internal server error" });
};
