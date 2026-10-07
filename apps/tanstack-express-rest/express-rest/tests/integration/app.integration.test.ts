// tests/integration/app.integration.test.ts
//
// The app factory's cross-cutting behaviour: the readiness endpoint the rig
// and every Playwright webServer waits on, and the JSON 404/500 envelopes so a
// client never receives an HTML error page from an API.

import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/app.ts";

describe("GET /healthz", () => {
  it("returns 200 with the readiness body", async () => {
    const response = await request(createApp()).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  // spec/contract.md: "may check DB connectivity; must not perform writes".
  // It deliberately does NOT check connectivity: Playwright starts the web
  // server before global-setup creates the database, so a healthz that touched
  // Postgres would never go ready on a clean machine.
  it("does not touch the database", async () => {
    // A fresh app whose db connection string is deliberately broken: if the
    // endpoint queried the database, the request would fail rather than 200.
    const response = await request(
      createApp({ postgresUrl: "postgresql://robo@localhost:5432/no_such_db" }),
    ).get("/healthz");

    expect(response.status).toBe(200);
  });
});

describe("unknown routes", () => {
  it("returns a JSON 404 envelope for an unknown API path", async () => {
    const response = await request(createApp()).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ error: "Not found" });
  });
});

describe("createApp", () => {
  it("returns a fresh app per call, so no state leaks between requests", () => {
    const first = createApp();
    const second = createApp();

    expect(first).not.toBe(second);
  });
});
