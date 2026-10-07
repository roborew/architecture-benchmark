// tests/integration/app.integration.test.ts
//
// The app factory's cross-cutting behaviour: the readiness endpoint the rig
// and every Playwright webServer waits on, and the JSON 404/500 envelopes so a
// client never receives an HTML error page from an API.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/app.ts";
import { startRpcServer, stopRpcServer } from "../helpers/rpc-server.ts";
import type { RpcServer } from "../helpers/rpc-server.ts";

let rpc: RpcServer;

beforeAll(() => {
  rpc = startRpcServer();
});

afterAll(async () => {
  await stopRpcServer(rpc.server);
});

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

  it("returns a JSON 404 envelope for an unmatched RPC path", async () => {
    // The RPCHandler reports `matched: false` when no procedure owns the
    // path, so the fall-through 404 below answers it — a client must never
    // receive an HTML error page from the RPC mount either.
    const response = await fetch(rpc.origin + "/rpc/does-not-exist", {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/json/);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});

describe("createApp", () => {
  it("returns a fresh app per call, so no state leaks between requests", () => {
    const first = createApp();
    const second = createApp();

    expect(first).not.toBe(second);
  });
});
