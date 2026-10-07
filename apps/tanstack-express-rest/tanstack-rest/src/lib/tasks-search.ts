// src/lib/tasks-search.ts
//
// The /tasks route's search params, validated once at the route boundary.
//
// The fields are typed optional so a plain `<Link to="/tasks">` stays valid
// without every caller having to pass a `search` object. Absent resolves to
// `undefined` rather than "" so the bare URL stays /tasks — a validator that
// returned empty strings would write them into the URL as ?q=&status=&…,
// which is not the URL the reference app produces.
//
// `status` is spelled as the URL spells it ("in-progress"); the stored value
// carries a space ("in progress"), and the translation between the two lives
// in the route's loader, where the reference variant keeps it.
//
// TanStack's default search parsing is JSON-based, so ?size=5 arrives as the
// *number* 5. A string-only check silently drops every numeric param — the
// page size, the page number, the project and assignee ids all vanished once
// that way — so both types are accepted and coerced to a string, which is
// what the pagination helpers already expect.

export type TasksSearch = {
	q?: string;
	project?: string;
	status?: string;
	assignee?: string;
	cursor?: string;
	page?: string;
	size?: string;
};

/** Coerces a validated search value to a string; unusable values become absent. */
export function toParam(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);

	return undefined;
}

export function parseTasksSearch(search: Record<string, unknown>): TasksSearch {
	return {
		q: toParam(search.q),
		project: toParam(search.project),
		status: toParam(search.status),
		assignee: toParam(search.assignee),
		cursor: toParam(search.cursor),
		page: toParam(search.page),
		size: toParam(search.size),
	};
}
