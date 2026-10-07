// src/middleware/not-found.ts
//
// The fall-through handler. Mounted after every route so an unmatched path
// answers with the API's JSON error envelope rather than Express's default
// HTML page — a REST client must never receive HTML.

import type { Request, Response } from "express";

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}
