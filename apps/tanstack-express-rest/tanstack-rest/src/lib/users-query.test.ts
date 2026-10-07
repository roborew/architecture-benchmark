import { beforeEach, describe, expect, it, vi } from "vitest";

import { usersQueryOptions } from "./users-query";

// The query options are the shared contract between the route loader
// (ensureQueryData) and the component (useQuery): the same options must
// produce the same cache key or the loader's prefetch would never be seen by
// the component.

const { getUsersMock } = vi.hoisted(() => ({ getUsersMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ getUsers: getUsersMock }));

beforeEach(() => {
	getUsersMock.mockReset();
	getUsersMock.mockResolvedValue([]);
});

describe("usersQueryOptions", () => {
	it("keys the cache by the term", () => {
		expect(usersQueryOptions("robin").queryKey).toEqual([
			"users",
			{ q: "robin" },
		]);
	});

	it("treats an absent term and an empty one as the same entry", () => {
		// The loader passes `q` straight from the search params; an undefined
		// key part would make "?q=" and "/" different cache entries for the
		// same server result. The empty value is dropped from the key — the
		// same normalisation every listing options object applies — so the
		// spelling of "no filter" cannot fork the cache.
		expect(usersQueryOptions().queryKey).toEqual(["users", {}]);
		expect(usersQueryOptions("").queryKey).toEqual(["users", {}]);
	});

	it("builds distinct keys for distinct terms", () => {
		const first = usersQueryOptions("robin").queryKey;
		const second = usersQueryOptions("sam").queryKey;

		expect(first).not.toEqual(second);
	});

	it("fetches through the api client with the term", async () => {
		const options = usersQueryOptions("robin");

		// queryFn is optional in the options' static shape; the cast asserts the
		// wiring this test exists to pin.
		await (options.queryFn as () => Promise<unknown>)();

		expect(getUsersMock).toHaveBeenCalledWith("robin");
	});
});
