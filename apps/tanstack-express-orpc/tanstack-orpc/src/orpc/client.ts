// src/orpc/client.ts
//
// How the SPA talks to the server — the oRPC half of the api layer.
//
// One `RPCLink` client, typed from the mirrored contract (./contract.ts) alone,
// so no server code can leak into the SPA bundle: the link derives each
// procedure's path from the router shape and speaks the RPC protocol the
// API's RPCHandler serves at /rpc. The `url` below MUST match that handler's
// prefix (see ../../express-orpc/src/app.ts) — moving either without the
// other is the failure mode here.
//
// `orpc` is the TanStack Query option-builder view of the same client
// (createTanstackQueryUtils): the reads (src/queries/*-query.ts) build their
// query options from it, so the cache key, the queryFn and the invalidation
// all name the same procedure. The writes stay behind the api modules'
// `useApiAction` bridge (src/api/*), which owns the field-bag semantics and
// the ApiError translation.
//
// RPCLink sends every call as a POST (v2 rejects GET by default), so there is
// no method configuration to keep in sync — the handler and the link agree
// out of the box.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { contract } from "./contract.ts";

/**
 * Where the Express API lives. Overridable per environment (e2e points it at
 * its own server), exactly as the REST variant's API_URL was.
 */
export const API_ORIGIN: string =
  import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const link = new RPCLink({
  origin: API_ORIGIN,
  // Must match the prefix the API's RPCHandler is mounted under.
  url: "/rpc",
});

/**
 * The client the api layer calls.
 *
 * `createORPCClient` is generic over the CLIENT shape, so it is typed from the
 * mirrored contract via `RouterContractClient` — the docs' pattern for a
 * client that must not import the server.
 */
export const client: RouterContractClient<typeof contract> =
  createORPCClient(link);

/**
 * The option builders for the reads:
 *
 *   useQuery(orpc.tasks.list.queryOptions({ input: { status: "todo" } }))
 *
 * The key is derived from the procedure path + input, so the cache key, the
 * queryFn and any invalidation all name the same procedure.
 */
export const orpc = createTanstackQueryUtils(client);
