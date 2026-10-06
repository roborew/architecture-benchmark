// src/routes/healthz.ts
//
// The readiness endpoint named in spec/contract.md, and the one Playwright
// waits on before the suite starts.
//
// It is a server route rather than a page component because the contract
// specifies `GET /healthz` returning `{"ok":true}`, and the e2e webServer
// probe must not render a route tree. It performs no writes.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: true }),
    },
  },
});
