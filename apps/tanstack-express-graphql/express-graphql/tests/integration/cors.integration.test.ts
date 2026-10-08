// tests/integration/cors.integration.test.ts
//
// The frontend is a separate origin (a Vite dev server / SPA host), so every
// request the client makes is cross-origin. The browser only exposes the
// responses if the API answers the CORS contract: reflected origins on plain
// requests and a successful preflight.
//
// Cross-origin policy is owned by the Express cors() middleware in front of
// /graphql (Yoga's own CORS handling is off, so the policy is decided in one
// place), so the contract holds for the GraphQL endpoint exactly as it held
// for the REST routes. The plain request is a POST with a one-field query —
// the smallest operation a client can issue — and the preflights ask for the
// method and content type such a POST always sends.

import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "../../src/app.ts";

const FRONTEND_ORIGIN = "http://localhost:3000";

// The write and read clients both POST application/json documents carrying a
// query and variables — the GraphQL equivalent of the old plain GET's traffic.
const COUNT_QUERY = "query TaskCount { taskCount }";

function graphql(app: Express) {
  return request(app)
    .post("/graphql")
    .send({ query: COUNT_QUERY, variables: {} });
}

describe("CORS", () => {
  it("reflects the request origin on a plain POST", async () => {
    const response = await graphql(createApp()).set("Origin", FRONTEND_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      FRONTEND_ORIGIN,
    );

    // The request also executed — the reflection belongs to a served response,
    // not to an error page.
    expect(response.body.data.taskCount).toBe(6);
  });

  it("answers a preflight for POST /graphql", async () => {
    const response = await request(createApp())
      .options("/graphql")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBeLessThan(400);
    expect(response.headers["access-control-allow-origin"]).toBe(
      FRONTEND_ORIGIN,
    );
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("answers a preflight that asks for a JSON content type", async () => {
    // Every GraphQL request sends an application/json body, which always
    // triggers a preflight; the allowance has to be in place for any of them.
    const response = await request(createApp())
      .options("/graphql")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");

    expect(response.status).toBeLessThan(400);
    expect(response.headers["access-control-allow-headers"]).toContain(
      "content-type",
    );
  });
});
