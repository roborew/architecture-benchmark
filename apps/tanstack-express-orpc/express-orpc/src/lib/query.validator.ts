// src/lib/query.validator.ts
//
// Input validation for the `q` search term, shared by every read surface, kept
// pure so it can be unit tested without a transport. The router maps the error
// case onto the error envelope.
//
// The `:id` route-param parser this file used to carry is gone: under REST an
// id arrived as a string in a URL, so something had to parse it; under oRPC the
// contract's `.input()` types every id as `z.number().int()`, so the shape check
// moved into the contract and a non-integer id is a client bug rather than
// user error.

/** The longest search term worth sending to the database. */
export const MAX_SEARCH_TERM_LENGTH = 100;

export type ParsedSearchTerm =
  | { readonly ok: true; readonly term: string }
  | { readonly ok: false; readonly error: string };

/**
 * Parses the raw `q` value.
 *
 * Absent, empty and whitespace-only values are valid and mean "no filter" —
 * a bare call and a cleared field must both list every row.
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
