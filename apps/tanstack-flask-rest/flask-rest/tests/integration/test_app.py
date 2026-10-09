# tests/integration/test_app.py
#
# The app factory's cross-cutting behaviour: the readiness endpoint the rig
# and every Playwright webServer waits on, the JSON 404 envelopes so a
# client never receives an HTML error page from an API, and the connection
# pool's behaviour under the burst of parallel fetches the SPA's TanStack
# Query layer fires.

import threading

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


class TestConnectionPool:
    def test_serves_a_burst_of_parallel_requests_without_exhausting_the_pool(
        self, e2e_url
    ):
        # The SPA's TanStack Query layer fires bursts of parallel fetches (the
        # e2e browser suite caught exactly that burst erroring a pool that
        # refused waiters, answering 500s mid-listing). The gateway queues like
        # postgres.js does, so a burst larger than the pool still answers every
        # request.
        application = create_app(postgres_url=e2e_url)
        statuses: list[int] = []
        lock = threading.Lock()

        def hit() -> None:
            with application.test_client() as client:
                status = client.get("/api/tasks?limit=25").status_code
            with lock:
                statuses.append(status)

        # Twice the pool's ceiling, all in flight at once.
        threads = [threading.Thread(target=hit) for _ in range(20)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert statuses == [200] * 20


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
