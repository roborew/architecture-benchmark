# tests/unit/test_query_validator.py
#
# The shared query-param validators' pure contract: the `q` search term and
# the `:id` route param. Values arrive as the list the request carried for
# one name, mirroring the express variant's undefined/string/array trichotomy
# that these rules encode. No database, no Flask.

import pytest

from src.lib.query_validator import (
    QueryParamError,
    parse_id_param,
    parse_search_term,
)


class TestParseSearchTerm:
    def test_treats_absent_empty_and_whitespace_as_no_filter(self):
        assert parse_search_term([]) == ""
        assert parse_search_term([""]) == ""
        assert parse_search_term(["   "]) == ""

    def test_trims_a_single_value(self):
        assert parse_search_term(["  robin  "]) == "robin"

    def test_passes_a_100_character_term_through_as_valid(self):
        term = "a" * 100

        assert parse_search_term([term]) == term

    def test_rejects_a_term_over_the_bound(self):
        with pytest.raises(QueryParamError) as raised:
            parse_search_term(["a" * 101])

        assert str(raised.value) == "q must be at most 100 characters"

    def test_rejects_a_repeated_param(self):
        # Silently picking one of the two values would hide the client bug.
        with pytest.raises(QueryParamError) as raised:
            parse_search_term(["robin", "sam"])

        assert str(raised.value) == "q must be a single value"


class TestParseIdParam:
    def test_accepts_a_positive_integer(self):
        assert parse_id_param("1") == 1
        assert parse_id_param("999") == 999

    def test_rejects_zero_and_negatives(self):
        for raw in ("0", "-1"):
            with pytest.raises(QueryParamError) as raised:
                parse_id_param(raw)

            assert str(raised.value) == "id must be a positive integer"

    def test_rejects_anything_that_cannot_name_a_row(self):
        for raw in ("abc", "1.5", "1e3", " 1", ""):
            with pytest.raises(QueryParamError) as raised:
                parse_id_param(raw)

            assert str(raised.value) == "id must be a positive integer"

    def test_rejects_none(self):
        with pytest.raises(QueryParamError):
            parse_id_param(None)


if __name__ == "__main__":
    pytest.main([__file__])
