"""tests/unit/test_cursor.py

The keyset cursor, ported verbatim from the reference variant along with its
tests. spec/queries.md requires the "older" link to carry an opaque cursor for
`(created_at, id)`. Opaque means the page does not have to know how the tuple
is packed, so these tests pin the round-trip and the failure behaviour rather
than the exact bytes. No database, no FastAPI.
"""

from __future__ import annotations

import base64
import re
from urllib.parse import quote

from app.lib.cursor import Cursor, decode_cursor, encode_cursor


class TestEncodeCursor:
    def test_round_trips_a_timestamp_and_id(self) -> None:
        cursor = encode_cursor("2026-09-28T10:15:00.000000Z", 101)

        assert decode_cursor(cursor) == Cursor(
            created_at="2026-09-28T10:15:00.000000Z",
            id=101,
        )

    def test_is_stable_so_the_same_page_cursor_yields_the_same_page(self) -> None:
        # spec/queries.md requires the cursor be "stable and repeatable".
        first = encode_cursor("2026-09-28T10:15:00.000000Z", 101)
        second = encode_cursor("2026-09-28T10:15:00.000000Z", 101)

        assert first == second

    def test_produces_a_value_safe_to_put_in_a_query_string(self) -> None:
        cursor = encode_cursor("2026-09-28T10:15:00.000000Z", 101)

        assert re.fullmatch(r"[A-Za-z0-9_-]+", cursor)
        # quote() is Python's encodeURIComponent: an opaque cursor must
        # survive it unchanged to be safe inside a ?cursor= parameter.
        assert quote(cursor, safe="") == cursor

    def test_distinguishes_cursors_that_differ_only_by_id(self) -> None:
        # The id is the tiebreaker for rows sharing a created_at, so dropping
        # it would make two different pages resolve to the same cursor.
        a = encode_cursor("2026-09-28T10:15:00.000000Z", 101)
        b = encode_cursor("2026-09-28T10:15:00.000000Z", 102)

        assert a != b


class TestDecodeCursor:
    def test_returns_none_for_an_absent_cursor(self) -> None:
        # None is both of the Express tests' null and undefined; "" is the
        # empty ?cursor= a cleared link carries.
        assert decode_cursor(None) is None
        assert decode_cursor("") is None

    def test_returns_none_for_a_cursor_that_was_not_produced_by_encode_cursor(
        self,
    ) -> None:
        # A hand-edited or stale cursor must not reach the query: it would
        # either throw or, worse, silently select the wrong page. The model
        # then reads the first page instead of failing the request.
        assert decode_cursor("not-a-cursor") is None
        assert decode_cursor("!!!!") is None

    def test_returns_none_for_a_well_formed_payload_with_a_non_numeric_id(
        self,
    ) -> None:
        # The same forged base64url payload the Express test packs.
        forged = (
            base64.urlsafe_b64encode(b"2026-09-28T10:15:00.000000Z|abc")
            .decode("ascii")
            .rstrip("=")
        )

        assert decode_cursor(forged) is None
