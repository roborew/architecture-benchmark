// tests/integration/cors.integration.test.ts
//
// The frontend is a separate origin (a Vite dev server / SPA host), so every
// fetch the TanStack Query layer makes is cross-origin. The browser only
// exposes the responses if the API answers the CORS contract: reflected
// origins on simple requests and a successful preflight.

import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/app.ts";

const FRONTEND_ORIGIN = "http://localhost:3000";

describe("CORS", () => {
  it("reflects the request origin on a simple GET", async () => {
    const response = await request(createApp())
      .get("/api/users")
      .set("Origin", FRONTEND_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      FRONTEND_ORIGIN,
    );
  });

  it("answers a preflight for GET /api/users", async () => {
    const response = await request(createApp())
      .options("/api/users")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).toBeLessThan(400);
    expect(response.headers["access-control-allow-origin"]).toBe(
      FRONTEND_ORIGIN,
    );
    expect(response.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("answers a preflight that asks for a JSON content type", async () => {
    // The write endpoints (later cycles) send application/json bodies, which
    // always triggers a preflight; the allowance has to be in place first.
    const response = await request(createApp())
      .options("/api/users")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");

    expect(response.status).toBeLessThan(400);
    expect(response.headers["access-control-allow-headers"]).toContain(
      "content-type",
    );
  });
});
