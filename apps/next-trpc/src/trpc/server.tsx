import "server-only";

// <-- guarantees this module can never be imported from a client component

import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { cache } from "react";

import { makeQueryClient } from "./query-client";
import { appRouter } from "./routers/_app";

/**
 * cache() makes every call within a single request resolve to the SAME client,
 * so a query prefetched high in the RSC tree is still there further down.
 */
export const getQueryClient = cache(makeQueryClient);

/**
 * The server-side proxy. Procedures are read as query options, never called
 * directly:
 *
 *   const people = await getQueryClient().fetchQuery(
 *     trpc.users.list.queryOptions({ search: "" }),
 *   );
 */
export const trpc = createTRPCOptionsProxy({
  // The router is contextless (see init.ts), but the proxy still requires the
  // property. An empty object is the honest value: there is nothing per-request
  // to thread through yet. Populate it when auth arrives.
  ctx: {},
  router: appRouter,
  queryClient: getQueryClient,
});
