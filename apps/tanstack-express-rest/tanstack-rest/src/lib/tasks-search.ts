// src/lib/tasks-search.ts
//
// The /tasks route's search params, validated once at the route boundary.
//
// `q` is typed optional so a plain `<a href="/tasks">` stays valid without every
// caller having to pass `search`. Absent resolves to `undefined` rather than ""
// so the bare URL stays /tasks, and numeric values are coerced because a client
// built with TanStack's default JSON-ish search parsing can deliver ?q=5 as the
// number 5.

export type TasksSearch = { q?: string };

export function parseTasksSearch(search: Record<string, unknown>): TasksSearch {
  return {
    q:
      typeof search.q === "string"
        ? search.q
        : typeof search.q === "number" && Number.isFinite(search.q)
          ? String(search.q)
          : undefined,
  };
}
