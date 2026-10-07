import { describe, expect, it } from "vitest";

import { orpc } from "@/orpc/client";
import { taskCountQueryOptions, tasksQueryOptions } from "./tasks-query";

// The query options are the shared contract between the route loader
// (ensureQueryData) and the component (useQuery): the same options must
// produce the same cache key or the loader's prefetch would never be seen by
// the component. The key must also agree with the request: two filter sets
// that build the same procedure input (an absent term and an empty one) must
// be one cache entry, or the prefetch and the read would silently miss each
// other.
//
// The options are the oRPC procedures' own option builders now, so the key is
// derived by the library from the procedure path + input. What this suite
// pins is the wiring (each factory delegates to the right procedure with the
// right input) and that normalisation.

describe("tasksQueryOptions", () => {
	it("delegates to tasks.list with the filters as the input", () => {
		expect(tasksQueryOptions({ q: "robin", status: "todo" }).queryKey).toEqual(
			orpc.tasks.list.queryOptions({ input: { q: "robin", status: "todo" } })
				.queryKey,
		);
	});

	it("keys every request-affecting filter", () => {
		const filters = {
			q: "draft",
			status: "in progress",
			projectId: 2,
			assigneeId: 4,
			cursor: "Y3Vyc29y",
			limit: 6,
		};

		expect(tasksQueryOptions(filters).queryKey).toEqual(
			orpc.tasks.list.queryOptions({ input: filters }).queryKey,
		);
	});

	it("drops empty filters, as an empty filter and an absent one are one input", () => {
		// ?q= and no q at all are the same request, so they must be the same
		// cache entry: a loader prefetching one and a component reading the
		// other would otherwise miss.
		expect(tasksQueryOptions({ q: "" }).queryKey).toEqual(
			tasksQueryOptions({}).queryKey,
		);
	});

	it("treats a null cursor and an absent one as the same first page", () => {
		expect(tasksQueryOptions({ cursor: null }).queryKey).toEqual(
			tasksQueryOptions({}).queryKey,
		);
	});

	it("builds distinct keys for distinct filters", () => {
		const first = tasksQueryOptions({ q: "robin" }).queryKey;
		const second = tasksQueryOptions({ q: "sam" }).queryKey;

		expect(first).not.toEqual(second);
	});
});

describe("taskCountQueryOptions", () => {
	it("keys the count cache separately from the list", () => {
		// The count is a different aggregate with a different lifetime: a stale
		// list page after a mutation must not be able to answer a fresh count
		// read from the list's entry, or the summary line would lag the data.
		expect(taskCountQueryOptions({ q: "robin" }).queryKey).not.toEqual(
			tasksQueryOptions({ q: "robin" }).queryKey,
		);
	});

	it("delegates to tasks.count with the filters as the input", () => {
		expect(
			taskCountQueryOptions({ q: "robin", status: "todo", projectId: 2 })
				.queryKey,
		).toEqual(
			orpc.tasks.count.queryOptions({
				input: { q: "robin", status: "todo", projectId: 2 },
			}).queryKey,
		);
	});

	it("drops empty filters, as an empty filter and an absent one are one input", () => {
		expect(taskCountQueryOptions({ q: "" }).queryKey).toEqual(
			taskCountQueryOptions().queryKey,
		);
	});
});
