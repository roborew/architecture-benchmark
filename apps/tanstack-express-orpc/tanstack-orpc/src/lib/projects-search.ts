// src/lib/projects-search.ts
//
// The /projects route's search params, validated once at the route boundary.
//
// `q` is typed optional so a plain `<Link to="/projects">` stays valid without
// every caller having to pass a `search` object. Absent resolves to
// `undefined` rather than "" so the bare URL stays /projects — a validator
// that returned an empty string would serialise it as /projects?q=, which is
// not the URL the reference app produces. Numeric values are coerced because a
// client built with TanStack's default JSON-ish search parsing can deliver
// ?q=5 as the number 5.

export type ProjectsSearch = { q?: string };

export function parseProjectsSearch(
	search: Record<string, unknown>,
): ProjectsSearch {
	return {
		q:
			typeof search.q === "string"
				? search.q
				: typeof search.q === "number" && Number.isFinite(search.q)
					? String(search.q)
					: undefined,
	};
}
