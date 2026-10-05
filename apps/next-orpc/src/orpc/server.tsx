import "server-only";

// <-- guarantees this module can never be imported from a client component

// The server-side caller.
//
// This is the file where oRPC most obviously beats the tRPC arrangement, so the
// difference is worth reading before the rest.
//
// Under tRPC there was no in-process caller: `trpc.users.list.queryOptions(...)`
// built query options that, when prefetched during SSR, travelled over HTTP to
// this app's own /api/trpc endpoint. The server was fetching from itself on every
// render, which is a real latency and failure cost. (oRPC's own blog post,
// "Stop Making HTTP Requests to Yourself During SSR", exists because of it.)
//
// `createRouterClient` calls the router directly, in process, with no HTTP hop
// and no serialization round-trip. Prefetching on the server now runs the same
// handler the browser would, just without the network in between.

import { createRouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { cache } from "react";

import { makeQueryClient } from "./query-client";
import { router } from "./routers/_app";

/**
 * The in-process client.
 *
 * Note this is NOT wrapped in `cache()` the way tRPC's `getQueryClient` was, and
 * deliberately so: `createRouterClient` bakes in the initial context, so one
 * instance must not be shared across requests when auth arrives — a shared
 * instance would leak one user's context into another user's render. Until there
 * is a context to leak (`src/orpc/context.ts` is empty) the instance holds
 * nothing request-specific, so sharing is safe and avoids rebuilding per render.
 *
 * When auth lands, pass `context: async () => ({ headers: await headers() })`
 * and move this inside a `cache()`d factory so each request builds its own.
 */
const client = createRouterClient(router, {
  context: {},
});

/**
 * The server-side option builders. Same shape as the client-side `orpc`, so a
 * component reads identically on both sides:
 *
 *   const people = await getQueryClient().fetchQuery(
 *     orpc.users.list.queryOptions({ input: { search: "" } }),
 *   );
 *
 * Only the transport underneath differs — in-process here, HTTP in the browser.
 */
export const orpc = createTanstackQueryUtils(client);

/**
 * `cache()` makes every call within a single request resolve to the SAME query
 * client, so a query prefetched high in the RSC tree is still there further down.
 */
export const getQueryClient = cache(makeQueryClient);
