import { describe, expect, it } from "vitest";

import { orpc } from "@/orpc/client";
import { commentsQueryOptions } from "./comments-query";
import { dashboardQueryOptions } from "./dashboard-query";
import { taskQueryOptions } from "./tasks-query";
import { userQueryOptions, userTasksQueryOptions } from "./users-query";

// The query options are the shared contract between the route loader
// (ensureQueryData) and the component (useQuery): the same options must
// produce the same cache key or the loader's prefetch would never be seen by
// the component. These are the single-fetch options — a key that identifies
// the one row (or aggregate) the procedure returns.
//
// The options are the oRPC procedures' own option builders now, so the key is
// derived by the library from the procedure path + input. What this suite
// pins is the wiring: each factory delegates to the right procedure with the
// right input, and each id keys its own entry.

describe("commentsQueryOptions", () => {
  it("delegates to tasks.comments with the task id", () => {
    expect(commentsQueryOptions(9).queryKey).toEqual(
      orpc.tasks.comments.queryOptions({ input: { id: 9 } }).queryKey,
    );
    expect(commentsQueryOptions(10).queryKey).not.toEqual(
      commentsQueryOptions(9).queryKey,
    );
  });
});

describe("taskQueryOptions", () => {
  it("delegates to tasks.byId with the id, apart from the workspace-wide list", () => {
    expect(taskQueryOptions(4).queryKey).toEqual(
      orpc.tasks.byId.queryOptions({ input: { id: 4 } }).queryKey,
    );
    expect(taskQueryOptions(4).queryKey).not.toEqual(
      orpc.tasks.list.queryOptions({ input: {} }).queryKey,
    );
  });
});

describe("dashboardQueryOptions", () => {
  it("delegates to dashboard.get — the dashboard is one aggregate", () => {
    expect(dashboardQueryOptions().queryKey).toEqual(
      orpc.dashboard.get.queryOptions().queryKey,
    );
  });
});

describe("userQueryOptions", () => {
  it("delegates to users.byId with the id", () => {
    expect(userQueryOptions(4).queryKey).toEqual(
      orpc.users.byId.queryOptions({ input: { id: 4 } }).queryKey,
    );
  });
});

describe("userTasksQueryOptions", () => {
  it("delegates to users.tasks with the id, apart from the member's own row", () => {
    expect(userTasksQueryOptions(4).queryKey).toEqual(
      orpc.users.tasks.queryOptions({ input: { id: 4 } }).queryKey,
    );
    expect(userTasksQueryOptions(4).queryKey).not.toEqual(
      userQueryOptions(4).queryKey,
    );
  });
});
