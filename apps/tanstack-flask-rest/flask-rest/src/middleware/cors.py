# src/middleware/cors.py
#
# The CORS contract, mirroring the express variant's `cors({ origin: true })`.
#
# The frontend is a separate origin (a Vite dev server / SPA host), so every
# fetch the TanStack Query layer makes is cross-origin. Origins are reflected
# rather than allowlisted: this API serves no cookies or credentials, so there
# is nothing a reflected origin could smuggle. A credentialed API would need
# an explicit allowlist instead.
#
# Flask has no `cors()` middleware; the same contract is two hooks —
# `after_request` stamps the reflected origin onto every response (error
# envelopes included, which is where a browser needs it most), and
# `before_request` answers a genuine preflight (OPTIONS + Origin +
# Access-Control-Request-Method, exactly what the `cors` package treats as
# one) without touching the routes.

from flask import Flask, Response, request

#: What the `cors` package allows by default: the methods this API's surface
#: uses plus the universal ones.
ALLOWED_METHODS = "GET, HEAD, PUT, PATCH, POST, DELETE"


def _append_vary_origin(response: Response) -> None:
    """Marks the response as varying by Origin, so caches keep origins apart."""
    vary = response.headers.get("Vary")
    response.headers["Vary"] = f"{vary}, Origin" if vary else "Origin"


def add_cors(app: Flask) -> None:
    """Wires the reflected-origin CORS contract onto the app."""

    @app.after_request
    def add_cors_headers(response: Response) -> Response:
        origin = request.headers.get("Origin")

        if origin is not None:
            response.headers["Access-Control-Allow-Origin"] = origin
            _append_vary_origin(response)

        return response

    @app.before_request
    def answer_preflight() -> Response | None:
        origin = request.headers.get("Origin")
        requested_method = request.headers.get("Access-Control-Request-Method")

        if request.method != "OPTIONS" or not origin or not requested_method:
            return None

        response = Response(status=204)
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = ALLOWED_METHODS

        # Reflect the requested headers, as the `cors` package does: the API
        # knows exactly one request header it ever reads (content-type).
        requested_headers = request.headers.get("Access-Control-Request-Headers")
        if requested_headers:
            response.headers["Access-Control-Allow-Headers"] = requested_headers

        _append_vary_origin(response)
        return response
