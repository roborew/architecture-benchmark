# app/lib/http_error.py
#
# The typed error a controller raises for every outcome the API answers with
# something other than a 2xx: the HTTP status plus the exact JSON payload the
# client should receive.
#
# Controllers return successes and raise ApiError for every failure;
# app/errors.py maps the raise onto JSONResponse(status, payload). That keeps
# the JSON error envelope ({ error, ... }) described in exactly one place — the
# controller that decided the outcome — instead of being re-derived from an
# error message deep in the stack, and it lets the pure validators produce
# plain data that the controller wraps, rather than validators knowing about
# HTTP.

from __future__ import annotations

from typing import Any

Payload = dict[str, Any]


class ApiError(Exception):
    """A deliberate non-2xx outcome: `status` plus the exact JSON payload."""

    def __init__(self, status: int, payload: Payload) -> None:
        # payload["error"] is the envelope's human-readable line, so it
        # doubles as the exception message a log or a test sees.
        error = payload.get("error")
        message = error if isinstance(error, str) else f"HTTP {status}"
        super().__init__(message)
        self.name = "ApiError"
        self.status = status
        self.payload: Payload = payload

    @staticmethod
    def validation(error: str, errors: dict[str, list[str]]) -> ApiError:
        """400 with the field → messages envelope a validation failure produces."""
        return ApiError(400, {"error": error, "errors": errors})

    @staticmethod
    def bad_request(error: str) -> ApiError:
        """400 with the API's plain `{ error }` envelope."""
        return ApiError(400, {"error": error})

    @staticmethod
    def not_found(error: str) -> ApiError:
        """404 with the API's plain `{ error }` envelope."""
        return ApiError(404, {"error": error})

    @staticmethod
    def conflict(error: str) -> ApiError:
        """409 with the reference's FK guard message."""
        return ApiError(409, {"error": error})
