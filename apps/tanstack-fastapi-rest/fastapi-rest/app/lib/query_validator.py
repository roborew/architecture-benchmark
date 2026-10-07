# app/lib/query_validator.py
#
# Input validation for the `q` search param and the `:id` route param, shared
# by every read surface, kept pure so it can be unit tested without FastAPI.
# The controller maps the error case onto the JSON 400 envelope.
#
# The values here are the raw query bag's (see app/lib/request_bag.py): an
# absent param is None, a repeated one arrives as a list — the same shape
# Express's req.query gives its validators, so a repeated param is rejected
# rather than silently picking one of the two values.

from __future__ import annotations

import re

# The longest search term worth sending to the database.
MAX_SEARCH_TERM_LENGTH = 100

_DIGITS = re.compile(r"^\d+$")
SIGNED_INTEGER = re.compile(r"^-?\d+$")


def parse_search_term(raw: object) -> tuple[str, None] | tuple[None, str]:
    """Parses the raw `q` query value: `(term, None)` or `(None, error)`.

    Absent, empty and whitespace-only values are valid and mean "no filter" —
    a bare URL (`/api/users`) and a cleared field (`/api/users?q=`) must both
    list every member. A repeated param (`?q=a&q=b`) arrives as a list and is
    rejected: silently picking one of the two values would hide the client bug.
    """
    if raw is None:
        return "", None

    if not isinstance(raw, str):
        return None, "q must be a single value"

    term = raw.strip()

    if len(term) > MAX_SEARCH_TERM_LENGTH:
        return None, f"q must be at most {MAX_SEARCH_TERM_LENGTH} characters"

    return term, None


def parse_id_param(raw: object) -> tuple[int, None] | tuple[None, str]:
    """Parses a raw `:id` path param: `(id, None)` or `(None, error)`.

    A detail/update/delete URL names a row by primary key, so anything that is
    not a positive integer cannot name one. Rejecting it here — rather than
    binding it and letting Postgres fail the cast — keeps the response a clear
    400 envelope instead of a 500.
    """
    if not isinstance(raw, str) or not _DIGITS.match(raw):
        return None, "id must be a positive integer"

    id = int(raw)

    if id < 1:
        return None, "id must be a positive integer"

    return id, None
