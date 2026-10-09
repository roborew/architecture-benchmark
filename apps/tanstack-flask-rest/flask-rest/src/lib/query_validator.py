# src/lib/query_validator.py
#
# Input validation for the `q` search param and the `:id` route param, shared
# by every read surface, kept pure so it can be unit tested without Flask.
# The controller maps the error case onto the JSON 400 envelope.
#
# Query params arrive from the routing layer as the *list* of values the
# request carried for one name (Werkzeug's ``to_dict(flat=False)``), which maps
# exactly onto the express variant's undefined / string / array trichotomy:
# an empty list is "absent", one value is "a single value", more than one is
# the client bug the express variant also refuses.

import re
from collections.abc import Sequence

#: The longest search term worth sending to the database.
MAX_SEARCH_TERM_LENGTH = 100

#: Digits only, ASCII — what the express variant's /^\d+$/ accepts.
_ID_PATTERN = re.compile(r"[0-9]+", re.ASCII)


class QueryParamError(ValueError):
    """A query or route parameter the API refuses, carrying the exact
    client-facing message for the 400 envelope. Plain ``ValueError`` subtype:
    the validators stay free of anything HTTP-shaped."""


def parse_search_term(values: Sequence[str]) -> str:
    """Parses the raw `q` query values.

    Absent, empty and whitespace-only values are valid and mean "no filter" —
    a bare URL (`/api/users`) and a cleared field (`/api/users?q=`) must both
    list every member. A repeated param arrives as two values and is rejected:
    silently picking one of the two would hide the client bug.
    """
    if len(values) == 0:
        return ""

    if len(values) > 1:
        raise QueryParamError("q must be a single value")

    term = values[0].strip()

    if len(term) > MAX_SEARCH_TERM_LENGTH:
        raise QueryParamError(f"q must be at most {MAX_SEARCH_TERM_LENGTH} characters")

    return term


def parse_id_param(raw: str | None) -> int:
    """Parses a raw `:id` route param.

    A detail/update/delete URL names a row by primary key, so anything that is
    not a positive integer cannot name one. Rejecting it here — rather than
    binding it and letting Postgres fail the cast — keeps the response a clear
    400 envelope instead of a 500.
    """
    if not isinstance(raw, str) or _ID_PATTERN.fullmatch(raw) is None:
        raise QueryParamError("id must be a positive integer")

    id = int(raw)

    if id < 1:
        raise QueryParamError("id must be a positive integer")

    return id
