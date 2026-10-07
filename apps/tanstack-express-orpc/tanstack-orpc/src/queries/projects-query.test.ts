import { describe, expect, it } from "vitest";

import { orpc } from "@/orpc/client";
import {
  projectQueryOptions,
  projectsQueryOptions,
  projectTasksQueryOptions,
} from "./projects-query";

// The query options are the shared contract between the route loader
// (ensureQueryData) and the component (useQuery): the same options must
// produce the same cache key or the loader's prefetch would never be seen by
// the component. The board options key by the project id plus every filter
// that builds the input, so two filter sets that build the same input are one
// cache entry.
//
// The options are the oRPC procedures' own option builders now, so the key is
// derived by the library from the procedure path + input. What this suite
// pins is the wiring (each factory delegates to the right procedure with the
// right input) and that normalisation.

describe("projectsQueryOptions", () => {
  it("delegates to projects.list with the term as q, dropping an empty one", () => {
    expect(projectsQueryOptions("redesign").queryKey).toEqual(
      orpc.projects.list.queryOptions({ input: { q: "redesign" } }).queryKey,
    );
    expect(projectsQueryOptions("").queryKey).toEqual(
      projectsQueryOptions().queryKey,
    );
  });
});

describe("projectQueryOptions", () => {
  it("delegates to projects.byId with the id", () => {
    expect(projectQueryOptions(3).queryKey).toEqual(
      orpc.projects.byId.queryOptions({ input: { id: 3 } }).queryKey,
    );
    expect(projectQueryOptions(4).queryKey).not.toEqual(
      projectQueryOptions(3).queryKey,
    );
  });
});

describe("projectTasksQueryOptions", () => {
  it("delegates to projects.tasks with the id and the filters", () => {
    expect(
      projectTasksQueryOptions(3, { status: "todo", limit: 2 }).queryKey,
    ).toEqual(
      orpc.projects.tasks.queryOptions({
        input: { id: 3, status: "todo", limit: 2 },
      }).queryKey,
    );
  });

  it("drops empty filters, as an empty filter and an absent one are one input", () => {
    expect(projectTasksQueryOptions(3, { status: "" }).queryKey).toEqual(
      projectTasksQueryOptions(3).queryKey,
    );
  });

  it("treats a null cursor and an absent one as the same first page", () => {
    expect(projectTasksQueryOptions(3, { cursor: null }).queryKey).toEqual(
      projectTasksQueryOptions(3).queryKey,
    );
  });
});
