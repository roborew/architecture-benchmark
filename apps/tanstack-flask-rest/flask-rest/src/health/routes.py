# src/health/health.routes.py
#
# The readiness endpoint. spec/contract.md: `GET /healthz` returns HTTP 200
# with `{"ok":true}` — it may check DB connectivity, must not perform writes.
#
# It deliberately does NOT check connectivity: Playwright starts the web
# server before its global-setup creates the test database, so a healthz that
# touched Postgres would never go ready on a clean machine. (The app factory's
# ``Db`` connects lazily for the same reason — building the app must never
# open a socket.)

from flask import Flask, jsonify


def mount_health_routes(app: Flask) -> None:
    """The one route mounted on the app itself rather than a blueprint: it is
    the server's endpoint, not a domain's."""

    @app.get("/healthz")
    def healthz():
        return jsonify({"ok": True}), 200
