import {
  QueryClient,
  defaultShouldDehydrateQuery,
} from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Above 0 so SSR-hydrated queries don't immediately refetch on mount.
        staleTime: 30 * 1000,
      },
      dehydrate: {
        // Dehydrate in-flight queries too, so a prefetch started high in the RSC
        // tree can be consumed by a client component further down.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
    },
  });
}
