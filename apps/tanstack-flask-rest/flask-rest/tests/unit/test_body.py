# tests/unit/test_body.py
#
# The body helper's contract: how a write endpoint reads its JSON body,
# mirroring what the express variant gets from body-parser. No database — a
# Request is built straight from a WSGI environ.

import pytest
from flask import Request
from werkzeug.test import EnvironBuilder

from src.lib.body import request_body
from src.lib.http_error import HttpError


def make_request(data=None, content_type=None):
    builder = EnvironBuilder(
        method="POST", path="/", data=data, content_type=content_type
    )
    try:
        return Request(builder.get_environ())
    finally:
        builder.close()


class TestRequestBody:
    def test_a_non_json_request_has_no_parsed_body(self):
        # The validators see an empty field bag: every field reads as
        # unsubmitted, like a form that did not send it.
        assert (
            request_body(make_request(data="name=x", content_type="text/plain")) == {}
        )

    def test_a_valid_json_body_comes_back_as_the_field_bag(self):
        req = make_request(data='{"name": "Robin"}', content_type="application/json")

        assert request_body(req) == {"name": "Robin"}

    def test_an_empty_json_body_parses_as_an_empty_object(self):
        # body-parser special-cases the empty JSON body as "a common
        # client-side mistake" -> {}; so does this.
        req = make_request(data="", content_type="application/json")

        assert request_body(req) == {}

    def test_a_malformed_json_body_is_the_clients_mistake(self):
        req = make_request(data="{bad json", content_type="application/json")

        with pytest.raises(HttpError) as raised:
            request_body(req)

        assert raised.value.status == 400
        assert raised.value.payload == {"error": "Invalid JSON body"}

    def test_a_non_object_json_body_has_no_fields(self):
        # An array or a bare string is valid JSON but not a field bag; the
        # reference's FormData parse would see no fields either.
        req = make_request(data="[1, 2]", content_type="application/json")

        assert request_body(req) == {}
