// src/lib/query.validator.ts
//
// Input validation for the `q` search param and the `:id` route param, shared
// by every read surface, kept pure so it can be unit tested without Express.
// The controller maps the error case onto the JSON 400 envelope.

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
    return {
      ok: false,
      error: `q must be at most ${MAX_SEARCH_TERM_LENGTH} characters`,
    };
  }

  return { ok: true, term };
}

export type ParsedId =
  | { readonly ok: true; readonly id: number }
  | { readonly ok: false; readonly error: string };

/**
 * Parses a raw `:id` route param.
 *
 * A detail/update/delete URL names a row by primary key, so anything that is
 * not a positive integer cannot name one. Rejecting it here — rather than
 * binding it and letting Postgres fail the cast — keeps the response a clear
 * 400 envelope instead of a 500.
 */
export function parseIdParam(raw: unknown): ParsedId {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return { ok: false, error: "id must be a positive integer" };
  }

  const id = Number(raw);

  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, error: "id must be a positive integer" };
  }

  return { ok: true, id };
}
