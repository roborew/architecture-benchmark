# src/lib/body.py
#
# How a write endpoint reads its JSON body — the Flask counterpart of the
# express variant's `app.use(express.json())` plus the `entity.parse.failed`
# branch of its error handler, in one place.
#
# The rules mirror body-parser's, which the express variant sits on:
#
#   * a request that is not JSON at all has no parsed body — the validators
#     see an empty field bag, so every field reads as unsubmitted (null);
#   * a JSON request with an *empty* body parses as {} — body-parser
#     special-cases it as "a common client-side mistake", and so does this;
#   * a JSON request whose body cannot be parsed is the client's mistake:
#     HttpError 400 with the express variant's "Invalid JSON body" envelope;
#   * a valid but non-object JSON body (an array, a bare string) has no
#     fields either — the same bag the reference's FormData parse would
#     produce for a field the form did not submit.

from typing import Any

from flask import Request

from src.lib.http_error import HttpError


def request_body(req: Request) -> dict[str, Any]:
    """The request's JSON body as a field bag; never a non-dict, never a crash."""
    if not req.is_json:
        return {}

    # get_data(cache=True) keeps the bytes for get_json's own read.
    if not req.get_data(cache=True):
        return {}

    body = req.get_json(silent=True)

    if body is None:
        raise HttpError(400, {"error": "Invalid JSON body"})

    return body if isinstance(body, dict) else {}
