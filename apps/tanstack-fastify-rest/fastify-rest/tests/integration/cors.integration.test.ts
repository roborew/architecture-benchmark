// tests/integration/cors.integration.test.ts
//
// The frontend is a separate origin (a Vite dev server / SPA host), so every
// fetch the TanStack Query layer makes is cross-origin. The browser only
// exposes the responses if the API answers the CORS contract: reflected
// origins on simple requests and a successful preflight.
//
// The CORS behaviour is @fastify/cors's (the counterpart of the Express
// variant's `cors` middleware, configured the same way: reflected origins).

import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.ts";

const app = buildApp();

const FRONTEND_ORIGIN = "http://localhost:3000";

describe("CORS", () => {
  it("reflects the request origin on a simple GET", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { origin: FRONTEND_ORIGIN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      FRONTEND_ORIGIN,
    );
  });

  it("answers a preflight for GET /api/users", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/users",
      headers: {
        origin: FRONTEND_ORIGIN,
        "access-control-request-method": "GET",
      },
    });

    expect(response.statusCode).toBeLessThan(400);
    expect(response.headers["access-control-allow-origin"]).toBe(
      FRONTEND_ORIGIN,
    );
    expect(response.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("answers a preflight that asks for a JSON content type", async () => {
    // The write endpoints (later cycles) send application/json bodies, which
    // always triggers a preflight; the allowance has to be in place first.
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/users",
      headers: {
        origin: FRONTEND_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.statusCode).toBeLessThan(400);
    expect(response.headers["access-control-allow-headers"]).toContain(
      "content-type",
    );
  });
});
