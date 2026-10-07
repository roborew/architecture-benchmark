// src/lib/users-search.ts
//
// The /users route's search params, validated once at the route boundary.
//
// `q` is typed optional so a plain `<a href="/users">` stays valid without
// every caller having to pass `search`. Absent resolves to `undefined` rather
// than "" so the bare URL stays /users, and numeric values are coerced because
// a client built with TanStack's default JSON-ish search parsing can deliver
// ?q=5 as the number 5.

export type UsersSearch = { q?: string };

export function parseUsersSearch(search: Record<string, unknown>): UsersSearch {
	return {
		q:
			typeof search.q === "string"
				? search.q
				: typeof search.q === "number" && Number.isFinite(search.q)
					? String(search.q)
					: undefined,
	};
}
