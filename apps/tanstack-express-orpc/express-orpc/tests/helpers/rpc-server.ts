// tests/helpers/rpc-server.ts
//
// The integration suite's harness: the real Express app on an ephemeral
// listener, plus an oRPC client pointed at it — the same RPCLink transport
// the SPA's client uses, so an integration test exercises exactly the path
// production takes (adapter → handler → router → model → Postgres).
//
// This replaces the REST suite's supertest drive. Supertest speaks REST by
// construction; the RPC protocol is what the app serves now, so the honest
// integration drive is the client that speaks it — typed from the same
// contract the SPA mirrors, so a contract change breaks here first.
//
// `createApp` never binds a port itself (src/server.ts is the only place that
// listens), so binding here is the one sanctioned use outside production.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import type { Server } from "node:http";

import { createApp } from "../../src/app.ts";
import { contract } from "../../src/orpc/routers/_app.ts";

export interface RpcServer {
  /** The typed client, speaking the RPC protocol at /rpc. */
  client: RouterContractClient<typeof contract>;
  /** The raw origin (`http://localhost:<port>`), for fetch-level assertions. */
  origin: string;
  /** The listener; close it in afterAll. */
  server: Server;
}

export function startRpcServer(): RpcServer {
  const server = createApp().listen(0);
  const port = (server.address() as { port: number }).port;
  const origin = `http://localhost:${port}`;

  const client = createORPCClient(
    new RPCLink({ origin, url: "/rpc" }),
  ) as RouterContractClient<typeof contract>;

  return { client, origin, server };
}

/** Stops accepting connections and waits for in-flight requests to finish. */
export function stopRpcServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
