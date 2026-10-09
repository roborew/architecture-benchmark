# app/errors.py
#
# The exception handlers — the last middleware in the stack. FastAPI/Starlette
# forwards unhandled exceptions from async handlers here automatically; these
# convert anything that reaches them into the API's JSON error envelope, and
# log the underlying error once so a production failure is diagnosable from
# the server log without leaking internals to the client.
#
# Three kinds of error arrive here, with different treatment:
#
#   ApiError   an outcome a controller decided on — a 400 validation envelope,
#              a 404 for an unknown row, a 409 FK guard. The payload is the
#              exact JSON the controller chose, so it is passed through
#              untouched and NOT logged: these are expected replies, not
#              failures to diagnose.
#
#   StarletteHTTPException   a routing-level outcome (an unmatched path, a
#              wrong method). Re-shaped into this API's `{ error }` envelope
#              so a REST client never receives Starlette's own `detail` shape.
#
#   anything else   an unexpected failure (a database error the models
#              re-raise, a bug). Logged once, answered with the generic 500
#              envelope — the internals never reach the client. (A malformed
#              JSON body is the one non-ApiError that is still the client's
#              mistake, and it is turned into a 400 by the request-body reader
#              before it ever reaches this layer.)

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.lib.http_error import ApiError

logger = logging.getLogger("fastapi-rest")


def register_exception_handlers(app: FastAPI) -> None:
    """Attaches the JSON error envelopes to one app (the composition root,
    and any test that mounts a router on a bare app)."""

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=exc.payload)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        # An unmatched path must answer with this API's envelope rather than
        # Starlette's `{"detail": ...}` — a REST client never sees another
        # shape.
        if exc.status_code == 404:
            return JSONResponse(status_code=404, content={"error": "Not found"})
        return JSONResponse(
            status_code=exc.status_code, content={"error": str(exc.detail)}
        )

    # FastAPI's own request validation never fires in this API — bodies are
    # read as raw bags and validated by the domains' pure validators — but if
    # a future endpoint declares a pydantic body, its 422 must not leak the
    # framework's envelope either.
    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(status_code=422, content={"error": "Invalid request body"})

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        logger.exception("Unhandled request error:")
        return JSONResponse(status_code=500, content={"error": "Internal server error"})
