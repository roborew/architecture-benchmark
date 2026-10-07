import { describe, expect, it } from "vitest";

import { parseProjectsSearch } from "./projects-search";

// The route's validateSearch: the search param is validated once at the route
// boundary so a plain `<Link to="/projects">` stays valid without every caller
// having to pass `search`.

describe("parseProjectsSearch", () => {
	it("passes a string q through as itself", () => {
		expect(parseProjectsSearch({ q: "website" })).toEqual({ q: "website" });
	});

	it("keeps an empty string rather than dropping it", () => {
		// "?q=" means "no filter", the same server result as "/projects"; both
		// must stay valid.
		expect(parseProjectsSearch({ q: "" })).toEqual({ q: "" });
	});

	it("coerces a finite numeric q to a string", () => {
		// A client built with TanStack's default JSON-ish search parsing can
		// deliver ?q=5 as the number 5; the API needs the string.
		expect(parseProjectsSearch({ q: 5 })).toEqual({ q: "5" });
	});

	it("treats an absent q as undefined", () => {
		expect(parseProjectsSearch({})).toEqual({ q: undefined });
	});

	it("drops a q that is neither string nor number", () => {
		expect(parseProjectsSearch({ q: true })).toEqual({ q: undefined });
		expect(parseProjectsSearch({ q: ["website"] })).toEqual({
			q: undefined,
		});
		expect(parseProjectsSearch({ q: { q: "website" } })).toEqual({
			q: undefined,
		});
	});
});
