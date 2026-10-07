# src/middleware/error_handler.py
#
# The Flask counterpart of the express variant's error-handler + not-found
# middleware: anything a view raises is converted into the API's JSON error
# envelope, so a REST client never receives the HTML page Flask would render
# by default. Registered once, by the app factory, after every blueprint.
#
# Three kinds of error arrive here, with different treatment:
#
#   HttpError    an outcome a controller decided on — a 400 validation
#                envelope, a 404 for an unknown row, a 409 FK guard. The
#                payload is the exact JSON the controller chose, so it is
#                passed through untouched and NOT logged: these are expected
#                replies, not failures to diagnose.
#
#   HTTPException  the framework's own routing outcomes. An unmatched path is
#                the notFound middleware's JSON 404. A method mismatch is
#                answered as 404 too, because the express variant has no
#                method matching — a wrong-method request falls through its
#                routes to the same not-found envelope. A 400 from Flask
#                itself is the malformed-JSON case body-parser answers with
#                "Invalid JSON body" (src/lib/body.py handles it before Flask
#                can, this is the belt-and-braces path). Anything else keeps
#                its status with its reason line as the envelope.
#
#   Exception    an unexpected failure (a database error the models rethrow,
#                a bug). Logged once, answered with the generic 500 envelope —
#                the internals never reach the client.

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException

from src.lib.http_error import HttpError


def register_error_handlers(app: Flask) -> None:
    """Registers the JSON error envelopes on the app, in specificity order."""

    @app.errorhandler(HttpError)
    def handle_http_error(error: HttpError):
        return jsonify(error.payload), error.status

    @app.errorhandler(HTTPException)
    def handle_http_exception(error: HTTPException):
        if error.code in (404, 405):
            return jsonify({"error": "Not found"}), 404

        if error.code == 400:
            return jsonify({"error": "Invalid JSON body"}), 400

        return jsonify({"error": error.name}), error.code or 500

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception):
        app.logger.error("Unhandled request error: %s", error, exc_info=error)
        return jsonify({"error": "Internal server error"}), 500
