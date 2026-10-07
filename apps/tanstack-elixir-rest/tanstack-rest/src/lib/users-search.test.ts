import { describe, expect, it } from "vitest";

import { parseUsersSearch } from "./users-search";

// The route's validateSearch: the search param is validated once at the route
// boundary so a plain `<Link to="/users">` stays valid without every caller
// having to pass `search`.

describe("parseUsersSearch", () => {
	it("passes a string q through as itself", () => {
		expect(parseUsersSearch({ q: "robin" })).toEqual({ q: "robin" });
	});

	it("keeps an empty string rather than dropping it", () => {
		// "?q=" means "no filter", the same server result as "/users"; both
		// must stay valid.
		expect(parseUsersSearch({ q: "" })).toEqual({ q: "" });
	});

	it("coerces a finite numeric q to a string", () => {
		// A client built with TanStack's default JSON-ish search parsing can
		// deliver ?q=5 as the number 5; the API needs the string.
		expect(parseUsersSearch({ q: 5 })).toEqual({ q: "5" });
	});

	it("treats an absent q as undefined", () => {
		expect(parseUsersSearch({})).toEqual({ q: undefined });
	});

	it("drops a q that is neither string nor number", () => {
		expect(parseUsersSearch({ q: true })).toEqual({ q: undefined });
		expect(parseUsersSearch({ q: ["robin"] })).toEqual({ q: undefined });
		expect(parseUsersSearch({ q: { q: "robin" } })).toEqual({
			q: undefined,
		});
	});
});
