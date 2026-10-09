"""tests/integration/test_app.py

The app factory's cross-cutting behaviour: the readiness endpoint the rig
and every Playwright webServer waits on, and the JSON 404/500 envelopes so a
client never receives an HTML error page from an API.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

pytestmark = pytest.mark.integration


class TestGetHealthz:
    def test_returns_200_with_the_readiness_body(self, client: TestClient) -> None:
        response = client.get("/healthz")

        assert response.status_code == 200
        assert response.json() == {"ok": True}

    # spec/contract.md: "may check DB connectivity; must not perform writes".
    # It deliberately does NOT check connectivity: Playwright starts the web
    # server before global-setup creates the database, so a healthz that
    # touched Postgres would never go ready on a clean machine.
    def test_does_not_touch_the_database(self) -> None:
        # A fresh app whose db connection string is deliberately broken: if
        # the endpoint queried the database, the request would fail rather
        # than 200. The pool connects lazily, so building the app alone never
        # reaches the server.
        broken = create_app("postgresql://robo@localhost:5432/no_such_db")

        with TestClient(broken) as broken_client:
            response = broken_client.get("/healthz")

        assert response.status_code == 200


class TestUnknownRoutes:
    def test_returns_a_json_404_envelope_for_an_unknown_api_path(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/does-not-exist")

        assert response.status_code == 404
        assert "json" in response.headers["content-type"]
        assert response.json() == {"error": "Not found"}


class TestCreateApp:
    def test_returns_a_fresh_app_per_call_so_no_state_leaks_between_requests(
        self,
    ) -> None:
        first = create_app()
        second = create_app()

        assert first is not second
