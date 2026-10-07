import { describe, expect, it } from "vitest";

import { orpc } from "@/orpc/client";
import { usersQueryOptions } from "./users-query";

// The query options are the shared contract between the route loader
// (ensureQueryData) and the component (useQuery): the same options must
// produce the same cache key or the loader's prefetch would never be seen by
// the component.
//
// The options are the oRPC procedure's own option builders now
// (createTanstackQueryUtils over the RPC client), so the key is derived by
// the library from the procedure path + input. What this suite pins is the
// wiring (each factory delegates to the right procedure with the right
// input) and the normalisation (an absent term and an empty one are one cache
// entry, or the prefetch and the read would silently miss each other).

describe("usersQueryOptions", () => {
  it("delegates to users.list with the term as q", () => {
    expect(usersQueryOptions("robin").queryKey).toEqual(
      orpc.users.list.queryOptions({ input: { q: "robin" } }).queryKey,
    );
  });

  it("treats an absent term and an empty one as the same entry", () => {
    // The loader passes `q` straight from the search params; an undefined
    // key part would make "?q=" and "/" different cache entries for the
    // same server result. The empty value is normalised away — the same
    // normalisation every listing options object applies — so the spelling
    // of "no filter" cannot fork the cache.
    expect(usersQueryOptions().queryKey).toEqual(
      usersQueryOptions("").queryKey,
    );
  });

  it("builds distinct keys for distinct terms", () => {
    const first = usersQueryOptions("robin").queryKey;
    const second = usersQueryOptions("sam").queryKey;

    expect(first).not.toEqual(second);
  });
});
