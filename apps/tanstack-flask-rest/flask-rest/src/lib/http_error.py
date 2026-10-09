# src/lib/http_error.py
#
# The typed error a controller raises for every outcome the API answers with
# something other than a 2xx: the HTTP status plus the exact JSON payload the
# client should receive.
#
# Controllers decide successes (returning status + payload) and raise
# ``HttpError`` for every failure; ``src/middleware/error_handler.py`` maps the
# raise onto ``jsonify(payload), status``. That keeps the JSON error envelope
# ({error, ...}) described in exactly one place — the controller that decided
# the outcome — instead of being re-derived from an error message deep in the
# stack, and it lets the pure validators produce plain data that the controller
# wraps, rather than validators knowing about HTTP.

from typing import Any


class HttpError(Exception):
    """An HTTP outcome the API decided on deliberately.

    ``payload`` is the exact JSON body to answer with; ``payload["error"]`` is
    the envelope's human-readable line, so it doubles as the exception message
    a log or a test sees.
    """

    def __init__(self, status: int, payload: dict[str, Any]) -> None:
        error = payload.get("error")
        message = error if isinstance(error, str) else f"HTTP {status}"
        super().__init__(message)
        self.status = status
        self.payload = payload

    @classmethod
    def validation(cls, error: str, errors: dict[str, list[str]]) -> "HttpError":
        """400 with the field -> messages envelope a validation failure produces."""
        return cls(400, {"error": error, "errors": errors})

    @classmethod
    def not_found(cls, error: str) -> "HttpError":
        """404 with the API's plain ``{error}`` envelope."""
        return cls(404, {"error": error})

    @classmethod
    def conflict(cls, error: str) -> "HttpError":
        """409 with the reference's FK guard message."""
        return cls(409, {"error": error})
