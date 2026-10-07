// src/users/users.validator.ts
//
// Input validation for the users query params, kept pure so it can be unit
// tested without Express. The controller maps the error case onto the JSON
// 400 envelope.

/** The longest search term worth sending to the database. */
export const MAX_SEARCH_TERM_LENGTH = 100;

export type ParsedSearchTerm =
  | { readonly ok: true; readonly term: string }
  | { readonly ok: false; readonly error: string };

/**
 * Parses the raw `q` query value.
 *
 * Absent, empty and whitespace-only values are valid and mean "no filter" —
 * a bare URL (`/api/users`) and a cleared field (`/api/users?q=`) must both
 * list every member. A repeated param (`?q=a&q=b`) arrives as an array and is
 * rejected: silently picking one of the two values would hide the client bug.
 */
export function parseSearchTerm(raw: unknown): ParsedSearchTerm {
  if (raw === undefined) {
    return { ok: true, term: "" };
  }

  if (typeof raw !== "string") {
    return { ok: false, error: "q must be a single value" };
  }

  const term = raw.trim();

  if (term.length > MAX_SEARCH_TERM_LENGTH) {
    return { ok: false, error: `q must be at most ${MAX_SEARCH_TERM_LENGTH} characters` };
  }

  return { ok: true, term };
}
