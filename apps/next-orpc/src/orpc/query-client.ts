// The query client, and the one place oRPC touches TanStack Query's internals.
//
// The serializer is configured with NO custom handlers, which is deliberate.
// This app's data layer already stringifies every timestamp (see
// src/lib/types.ts), so plain JSON round-trips every value and there is nothing
// extra to teach the cache about.
//
// It is still worth having rather than leaving the client unconfigured, because
// the moment a procedure returns something JSON cannot represent — a Date, a Map,
// a BigInt — the three paths (hash the key, dehydrate, hydrate) must all agree,
// and configuring them once is what guarantees that. Add a handler here rather
// than stringifying at the SQL layer when that happens.
//
// Note this replaces `shouldDehydrateQuery` from the tRPC version. oRPC's
// streamed/live queries report `success` while still fetching, so the
// pending-status escape hatch that existed to let an RSC prefetch survive the
// walk down the tree is not needed.

import { RPCJsonSerializer } from "@orpc/client";
import {
  QueryClient,
  defaultShouldDehydrateQuery,
  hashKey,
} from "@tanstack/react-query";

const serializer = new RPCJsonSerializer();

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Above 0 so SSR-hydrated queries don't immediately refetch on mount.
        staleTime: 30 * 1000,
        // Hash the key the same way the payload is serialized, so a key
        // containing a non-JSON value still produces a stable hash.
        queryKeyHashFn: (queryKey) => {
          const { json, meta } = serializer.serialize(queryKey);

          return hashKey([json, meta?.map(String).sort()]);
        },
      },
      dehydrate: {
        shouldDehydrateQuery: defaultShouldDehydrateQuery,
        serializeData: (data) => serializer.serialize(data),
      },
      hydrate: {
        deserializeData: (data) => serializer.deserialize(data),
      },
    },
  });
}
