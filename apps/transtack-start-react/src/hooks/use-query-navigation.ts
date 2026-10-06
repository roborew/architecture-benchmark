// src/hooks/use-query-navigation.ts
//
// Navigation to `/tasks` with a query string, built the way TanStack expects.
//
// The Next.js app passed a finished URL to `router.push("/tasks?status=done")`,
// and next/navigation needed nothing further. TanStack's `navigate` takes a
// route and a *structured* `search` object; handing it a pre-joined
// "/tasks?status=done" string in `to` leaves the search half outside the
// route's own parser, so `validateSearch` never sees the values and the route
// silently renders its defaults.
//
// Every navigation to a filtered/paged list goes through here so the query is
// split into a path and params in exactly one place.

import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Navigates to `basePath` with `query` as structured search params.
 *
 * TanStack's `navigate` wants a route plus a `search` object. Passing a
 * pre-joined "/tasks?status=done" string in `to` leaves the query outside the
 * route's own parser, so `validateSearch` never sees it and the route silently
 * renders its defaults.
 *
 * `basePath` must be the route's *path* ("/tasks"), not the trailing-slash form
 * its id carries ("/tasks/") — the two are different route ids, and navigating
 * to one from the other is a navigation the router will not resolve.
 */
export function useQueryNavigation(basePath: string) {
  const router = useRouter();

  return useCallback(
    (query: URLSearchParams, options: { replace?: boolean } = {}) => {
      const search = Object.fromEntries(query.entries());

      // An empty query navigates to the bare path rather than "/tasks?" — the
      // route's validateSearch omits undefined params, so the cleaner URL is
      // also the one the loader and the e2e assertions expect.
      router.navigate({
        to: basePath,
        search: Object.keys(search).length > 0 ? search : undefined,
        ...(options.replace ? { replace: true } : {}),
        // Typing a search must not scroll the results panel out from under the
        // reader mid-keystroke.
        resetScroll: false,
      } as never);
    },
    [basePath, router],
  );
}
