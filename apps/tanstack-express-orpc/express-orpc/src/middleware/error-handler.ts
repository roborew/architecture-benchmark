// src/middleware/error-handler.ts
//
// The last middleware in the stack. Express 5 forwards rejections from async
// handlers here automatically; this converts anything that reaches it into a
// JSON error envelope, and logs the underlying error once so a production
// failure is diagnosable from the server log without leaking internals to the
// client.
//
// Note how little is left here: under REST, controllers threw HttpError and
// this middleware mapped each throw to its envelope. Under oRPC the routers
// throw ORPCError and the handlers themselves serialise it, so the outcomes
// the API decided on never reach Express. What remains is Express's own
// failures only — a malformed JSON body from the parser, a bug in a
// middleware — never a domain outcome.

import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (
    (error as { type?: string } | null)?.type === "entity.parse.failed" &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    // A malformed JSON body is the one Express-level failure that is still
    // the client's mistake: express.json() throws it with status 400, so it is
    // answered as a 400 rather than masquerading as a server fault.
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  console.error("Unhandled request error:", error);

  res.status(500).json({ error: "Internal server error" });
};
