# tests/unit/test_cursor.py
#
# The keyset cursor, ported verbatim from the reference variant along with its
# tests. spec/queries.md requires the "older" link to carry an opaque cursor
# for `(created_at, id)`. Opaque means the page does not have to know how the
# tuple is packed, so these tests pin the round-trip and the failure behaviour
# rather than the exact bytes.

import base64

import pytest

from src.lib.cursor import decode_cursor, encode_cursor


class TestEncodeCursor:
    def test_round_trips_a_timestamp_and_id(self):
        cursor = encode_cursor("2026-09-28T10:15:00.000000Z", 101)

        assert decode_cursor(cursor) is not None
        assert decode_cursor(cursor).created_at == "2026-09-28T10:15:00.000000Z"
        assert decode_cursor(cursor).id == 101

    def test_is_stable_so_the_same_page_cursor_yields_the_same_page(self):
        # spec/queries.md requires the cursor be "stable and repeatable".
        first = encode_cursor("2026-09-28T10:15:00.000000Z", 101)
        second = encode_cursor("2026-09-28T10:15:00.000000Z", 101)

        assert first == second

    def test_produces_a_value_safe_to_put_in_a_query_string(self):
        cursor = encode_cursor("2026-09-28T10:15:00.000000Z", 101)

        assert cursor == base64.urlsafe_b64encode(
            b"2026-09-28T10:15:00.000000Z|101"
        ).decode().rstrip("=")
        for character in cursor:
            assert character.isalnum() or character in "-_"

    def test_distinguishes_cursors_that_differ_only_by_id(self):
        # The id is the tiebreaker for rows sharing a created_at, so dropping
        # it would make two different pages resolve to the same cursor.
        a = encode_cursor("2026-09-28T10:15:00.000000Z", 101)
        b = encode_cursor("2026-09-28T10:15:00.000000Z", 102)

        assert a != b


class TestDecodeCursor:
    def test_returns_none_for_an_absent_cursor(self):
        assert decode_cursor(None) is None
        assert decode_cursor("") is None

    def test_returns_none_for_a_cursor_that_was_not_produced_by_encode(self):
        # A hand-edited or stale cursor must not reach the query: it would
        # either throw or, worse, silently select the wrong page. The model
        # then reads the first page instead of failing the request.
        assert decode_cursor("not-a-cursor") is None
        assert decode_cursor("!!!!") is None

    def test_returns_none_for_a_well_formed_payload_with_a_non_numeric_id(self):
        forged = (
            base64.urlsafe_b64encode(b"2026-09-28T10:15:00.000000Z|abc")
            .decode()
            .rstrip("=")
        )

        assert decode_cursor(forged) is None

    def test_pads_a_short_cursor_without_complaining(self):
        # The encoder strips padding; a value that already carries "=" is
        # tolerated too, like node's base64url decoder.
        padded = base64.urlsafe_b64encode(b"2026-09-28T10:15:00.000000Z|101").decode()

        assert decode_cursor(padded) is not None
        assert decode_cursor(padded).id == 101


if __name__ == "__main__":
    pytest.main([__file__])
