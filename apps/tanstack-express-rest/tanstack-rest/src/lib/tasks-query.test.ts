import { beforeEach, describe, expect, it, vi } from "vitest";

import { tasksQueryOptions } from "./tasks-query";

// The query options are the shared contract between the route loader
// (ensureQueryData) and the component (useQuery): the same options must
// produce the same cache key or the loader's prefetch would never be seen by
// the component.

const { getTasksMock } = vi.hoisted(() => ({ getTasksMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ getTasks: getTasksMock }));

beforeEach(() => {
  getTasksMock.mockReset();
  getTasksMock.mockResolvedValue([]);
});

describe("tasksQueryOptions", () => {
  it("keys the cache by the term", () => {
    expect(tasksQueryOptions("robin").queryKey).toEqual([
      "tasks",
      { q: "robin" },
    ]);
  });

  it("treats an absent term as the empty term, not undefined", () => {
    // The loader passes `q` straight from the search params; an undefined
    // key part would make "?q=" and "/" different cache entries for the
    // same server result.
    expect(tasksQueryOptions().queryKey).toEqual(["tasks", { q: "" }]);
  });

  it("builds distinct keys for distinct terms", () => {
    const first = tasksQueryOptions("robin").queryKey;
    const second = tasksQueryOptions("sam").queryKey;

    expect(first).not.toEqual(second);
  });

  it("fetches through the api client with the term", async () => {
    const options = tasksQueryOptions("robin");

    // queryFn is optional in the options' static shape; the cast asserts the
    // wiring this test exists to pin.
    await (options.queryFn as () => Promise<unknown>)();

    expect(getTasksMock).toHaveBeenCalledWith("robin");
  });
});
