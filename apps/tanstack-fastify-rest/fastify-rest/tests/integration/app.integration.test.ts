// tests/integration/app.integration.test.ts
//
// The app factory's cross-cutting behaviour: the readiness endpoint the rig
// and every Playwright webServer waits on, and the JSON 404/500 envelopes so a
// client never receives an HTML error page from an API.
//
// Where the Express variant drives `createApp()` with supertest (which binds
// a socket per app), this drives `buildApp()` with `inject()` — light-my-
// request dispatches the request through the Fastify route tree in-process,
// so no port is ever bound. One app instance serves the whole file: the app
// holds no request state, so reuse cannot leak between tests.

import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.ts";

const app = buildApp();

describe("GET /healthz", () => {
  it("returns 200 with the readiness body", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  // spec/contract.md: "may check DB connectivity; must not perform writes".
  // It deliberately does NOT check connectivity: Playwright starts the web
  // server before global-setup creates the database, so a healthz that touched
  // Postgres would never go ready on a clean machine.
  it("does not touch the database", async () => {
    // A fresh app whose db connection string is deliberately broken: if the
    // endpoint queried the database, the request would fail rather than 200.
    const response = await buildApp({
      postgresUrl: "postgresql://robo@localhost:5432/no_such_db",
    }).inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
  });
});

describe("unknown routes", () => {
  it("returns a JSON 404 envelope for an unknown API path", async () => {
    const response = await app.inject({ method: "GET", url: "/api/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.json()).toEqual({ error: "Not found" });
  });
});

describe("buildApp", () => {
  it("returns a fresh app per call, so no state leaks between requests", () => {
    const first = buildApp();
    const second = buildApp();

    expect(first).not.toBe(second);
  });
});
