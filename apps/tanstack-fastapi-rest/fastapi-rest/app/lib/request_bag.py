# app/lib/request_bag.py
#
# How a FastAPI Request becomes the plain value bags the validators consume.
#
# The Express variant's validators read `req.query` / `req.body` — plain maps
# where an absent key is undefined and a repeated query param is an array. The
# pure validators here consume the same shape, so their port stays faithful,
# and these two helpers are the only place that knows how Starlette represents
# a request.

from __future__ import annotations

import json
from typing import Any

from fastapi import Request

from .http_error import ApiError

QueryBag = dict[str, Any]
BodyBag = dict[str, Any]


def query_bag(request: Request) -> QueryBag:
    """The request's query params as Express's `req.query`: single → str, repeated → list.

    Express's default query parser is flat ("simple"), so `?a[b]=c` never
    becomes a nested object — a plain map with str-or-list values is the whole
    shape a validator can see.
    """
    bag: QueryBag = {}
    for key, value in request.query_params.multi_items():
        if key in bag:
            existing = bag[key]
            if isinstance(existing, list):
                existing.append(value)
            else:
                bag[key] = [existing, value]
        else:
            bag[key] = value
    return bag


async def read_json_body(request: Request) -> BodyBag:
    """The request's JSON body as a field bag, with Express's semantics.

    Mirrors `express.json()` + the validators' own `asBody`:

    * a non-JSON content type leaves the body unparsed (Express never parses
      it, so every field reads back as absent → the validators report their
      "omitted field" messages);
    * an empty body is `{}` (body-parser's rule);
    * a malformed body, or a top-level scalar where an object is required
      (body-parser's `strict` mode), is the client's mistake: a 400
      `{"error": "Invalid JSON body"}` rather than a server fault;
    * a top-level array is an object as far as the validators are concerned
      (`typeof [] === "object"`), so it has no fields.
    """
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("application/json"):
        return {}

    raw = (await request.body()).decode("utf-8", "replace").strip()
    if not raw:
        return {}

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise ApiError(400, {"error": "Invalid JSON body"}) from None

    if not isinstance(parsed, (dict, list)):
        raise ApiError(400, {"error": "Invalid JSON body"})

    return parsed if isinstance(parsed, dict) else {}
