# tests/integration/test_app.py
#
# The app factory's cross-cutting behaviour: the readiness endpoint the rig
# and every Playwright webServer waits on, and the JSON 404 envelopes so a
# client never receives an HTML error page from an API.

from src.app import create_app


class TestHealthz:
    def test_returns_200_with_the_readiness_body(self, client):
        response = client.get("/healthz")

        assert response.status_code == 200
        assert response.get_json() == {"ok": True}

    # spec/contract.md: "may check DB connectivity; must not perform writes".
    # It deliberately does NOT check connectivity: Playwright starts the web
    # server before global-setup creates the database, so a healthz that
    # touched Postgres would never go ready on a clean machine.
    def test_does_not_touch_the_database(self):
        # A fresh app whose connection string is deliberately broken: if the
        # endpoint queried the database, the request would fail rather than
        # 200. (The Db connects lazily for the same reason.)
        broken = create_app(
            postgres_url="postgresql://robo@localhost:5432/no_such_db"
        ).test_client()

        response = broken.get("/healthz")

        assert response.status_code == 200


class TestUnknownRoutes:
    def test_returns_a_json_404_envelope_for_an_unknown_api_path(self, client):
        response = client.get("/api/does-not-exist")

        assert response.status_code == 404
        assert response.content_type.startswith("application/json")
        assert response.get_json() == {"error": "Not found"}

    def test_answers_a_method_mismatch_as_the_express_fall_through_does(self, client):
        # The express variant has no method matching: a wrong-method request
        # falls through its routes to the not-found middleware. Same envelope,
        # so a client sees the same outcome from both variants.
        response = client.put("/api/users")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Not found"}


class TestCreateApp:
    def test_returns_a_fresh_app_per_call_so_no_state_leaks_between_requests(self):
        assert create_app() is not create_app()

    def test_serves_both_url_spellings_without_a_redirect(self, client):
        # The SPA fetches the bare mount path; the express variant serves both
        # spellings. Werkzeug would 308-redirect to the trailing slash by
        # default, which the app factory turns off.
        bare = client.get("/api/users")
        slashed = client.get("/api/users/")

        assert bare.status_code == 200
        assert slashed.status_code == 200

    def test_renders_json_keys_in_the_projections_order(self, client):
        response = client.get("/api/tasks")

        assert list(response.get_json()[0]) == [
            "id",
            "projectId",
            "projectName",
            "title",
            "description",
            "status",
            "assigneeName",
            "commentCount",
            "updatedAt",
            "updatedAtRaw",
            "cursorFor",
        ]
