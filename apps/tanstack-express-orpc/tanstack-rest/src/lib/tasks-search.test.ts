import { describe, expect, it } from "vitest";

import { parseTasksSearch } from "./tasks-search";

// The /tasks route's search params are validated once at the route boundary,
// so the loader and the URL can never disagree about what a param means. These
// tests pin that contract: which params exist, how a value is coerced, and
// what an absent or unusable value resolves to.

describe("parseTasksSearch", () => {
	it("returns undefined for a bare URL", () => {
		expect(parseTasksSearch({})).toEqual({
			q: undefined,
			project: undefined,
			status: undefined,
			assignee: undefined,
			cursor: undefined,
			page: undefined,
			size: undefined,
		});
	});

	it("keeps every offered param", () => {
		expect(
			parseTasksSearch({
				q: "navigation",
				project: "2",
				status: "in-progress",
				assignee: "4",
				cursor: "Y3Vyc29y",
				page: "3",
				size: "5",
			}),
		).toEqual({
			q: "navigation",
			project: "2",
			status: "in-progress",
			assignee: "4",
			cursor: "Y3Vyc29y",
			page: "3",
			size: "5",
		});
	});

	it("coerces a numeric value to a string", () => {
		// TanStack's default search parsing is JSON-based, so ?size=5 arrives
		// as the *number* 5. A string-only check would silently drop every
		// numeric param — the page size, the page number, the project and
		// assignee ids all vanished once that way.
		expect(parseTasksSearch({ q: 5, size: 10, page: 2 })).toEqual({
			q: "5",
			project: undefined,
			status: undefined,
			assignee: undefined,
			cursor: undefined,
			page: "2",
			size: "10",
		});
	});

	it("drops values that cannot be a param", () => {
		// An object, an array or null cannot be a meaningful value for any of
		// these params, so they resolve to "absent" rather than crashing the
		// validator.
		expect(parseTasksSearch({ q: null, status: [], assignee: {} })).toEqual({
			q: undefined,
			project: undefined,
			status: undefined,
			assignee: undefined,
			cursor: undefined,
			page: undefined,
			size: undefined,
		});
	});

	it("keeps a status spelled as the URL spells it", () => {
		// The stored status is "in progress", but a raw space is awkward in a
		// query string, so the URL carries "in-progress" and the loader owns
		// the translation. The validator must not mangle either spelling.
		expect(parseTasksSearch({ status: "in-progress" }).status).toBe(
			"in-progress",
		);
		expect(parseTasksSearch({ status: "todo" }).status).toBe("todo");
	});
});
