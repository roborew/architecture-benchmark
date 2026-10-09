"""tests/integration/test_cors.py

The frontend is a separate origin (a Vite dev server / SPA host), so every
fetch the TanStack Query layer makes is cross-origin. The browser only
exposes the responses if the API answers the CORS contract: reflected
origins on simple requests and a successful preflight.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

FRONTEND_ORIGIN = "http://localhost:3000"


class TestCors:
    def test_reflects_the_request_origin_on_a_simple_get(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users", headers={"Origin": FRONTEND_ORIGIN})

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN

    def test_answers_a_preflight_for_get_api_users(self, client: TestClient) -> None:
        response = client.options(
            "/api/users",
            headers={
                "Origin": FRONTEND_ORIGIN,
                "Access-Control-Request-Method": "GET",
            },
        )

        assert response.status_code < 400
        assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN
        assert "GET" in response.headers["access-control-allow-methods"]

    def test_answers_a_preflight_that_asks_for_a_json_content_type(
        self, client: TestClient
    ) -> None:
        # The write endpoints (later cycles) send application/json bodies,
        # which always triggers a preflight; the allowance has to be in place
        # first.
        response = client.options(
            "/api/users",
            headers={
                "Origin": FRONTEND_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

        assert response.status_code < 400
        assert "content-type" in response.headers["access-control-allow-headers"]
