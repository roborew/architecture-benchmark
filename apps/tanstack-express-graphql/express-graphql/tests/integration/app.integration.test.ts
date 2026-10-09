// tests/integration/app.integration.test.ts
//
// The app factory's cross-cutting behaviour: the readiness endpoint the rig
// and every Playwright webServer waits on, the framework header that stays
// off, and the fate of a path no route answers. The REST JSON 404/500
// envelopes left with the REST surface — GraphQL has no status codes of its
// own, and an unknown path now falls through to Express's default 404.

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

describe("framework headers", () => {
  it("does not advertise the framework (x-powered-by stays off)", async () => {
    const response = await request(createApp()).get("/healthz");

    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("unknown routes", () => {
  // CHANGE from the REST variant: the JSON 404 envelope (`{ error: "Not
  // found" }`) was written by the REST error handler, which was deleted with
  // the REST surface. No middleware answers unknown paths anymore, so
  // Express's own default 404 applies — the status is still contractual, the
  // body is Express's HTML.
  it("answers Express's default 404 for an unknown path", async () => {
    const response = await request(createApp()).get("/api/does-not-exist");

    expect(response.status).toBe(404);
  });
});

describe("createApp", () => {
  it("returns a fresh app per call, so no state leaks between requests", () => {
    const first = createApp();
    const second = createApp();

    expect(first).not.toBe(second);
  });
});
