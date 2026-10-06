// src/middleware/error-handler.ts
//
// The last middleware in the stack. Express 5 forwards rejections from async
// handlers here automatically; this converts anything that reaches it into the
// API's JSON error envelope with a 500, and logs the underlying error once so
// a production failure is diagnosable from the server log without leaking
// internals to the client.

import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("Unhandled request error:", error);

  res.status(500).json({ error: "Internal server error" });
};
