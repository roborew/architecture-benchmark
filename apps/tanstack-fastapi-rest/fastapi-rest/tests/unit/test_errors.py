"""tests/unit/test_errors.py

The exception handlers' mapping contract: a controller's ApiError becomes its
exact JSON envelope; a malformed JSON body becomes a 400; anything else is
logged once and answered with the generic 500. No database — the app is a
bare FastAPI whose routes raise the error under test, driven by the
TestClient (the Express test drove the middleware with a fake req/res).
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.errors import register_exception_handlers
from app.lib.http_error import ApiError
from app.lib.mutation import MutationResult
from app.lib.request_bag import read_json_body


def make_app() -> FastAPI:
    """A bare app with one route per error the handler must map, plus this
    API's exception handlers — the pytest port of the Express test's
    `invoke(error)`."""
    app = FastAPI()

    @app.get("/validation")
    async def validation_route() -> MutationResult:
        raise ApiError.validation(
            "Missing fields. Failed to create task.",
            {"title": ["Title is required."]},
        )

    @app.get("/not-found")
    async def not_found_route() -> MutationResult:
        raise ApiError.not_found("That task no longer exists.")

    @app.get("/conflict")
    async def conflict_route() -> MutationResult:
        raise ApiError.conflict(
            "This project still has 1 task. Delete it before deleting the project."
        )

    @app.post("/write")
    async def write_route(request: Request) -> MutationResult:
        # The write endpoints' adapter: the body is read as a raw field bag
        # before the controller ever sees it (app/lib/request_bag.py), so a
        # malformed body is rejected here — never the model's problem.
        await read_json_body(request)
        return MutationResult(ok=True)

    @app.get("/boom")
    async def boom_route() -> MutationResult:
        raise RuntimeError("db down")

    register_exception_handlers(app)
    return app


class TestExceptionHandlers:
    def test_maps_an_apierror_to_its_own_status_and_payload_untouched(self) -> None:
        response = TestClient(make_app()).get("/validation")

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"title": ["Title is required."]},
        }

    def test_maps_a_404_apierror_to_the_plain_envelope(self) -> None:
        response = TestClient(make_app()).get("/not-found")

        assert response.status_code == 404
        assert response.json() == {"error": "That task no longer exists."}

    def test_maps_a_409_apierror_to_the_reference_guard_message(self) -> None:
        response = TestClient(make_app()).get("/conflict")

        assert response.status_code == 409
        assert response.json() == {
            "error": "This project still has 1 task. Delete it before "
            "deleting the project."
        }

    def test_answers_a_malformed_json_body_as_a_400_not_a_server_fault(
        self,
    ) -> None:
        response = TestClient(make_app()).post(
            "/write", content="{oops", headers={"content-type": "application/json"}
        )

        assert response.status_code == 400
        assert response.json() == {"error": "Invalid JSON body"}

    def test_logs_an_unknown_error_once_and_answers_the_generic_500_envelope(
        self, caplog
    ) -> None:
        # Starlette's error middleware re-raises after sending the response;
        # the client is told not to surface that re-raise as a test failure.
        client = TestClient(make_app(), raise_server_exceptions=False)

        with caplog.at_level(logging.ERROR, logger="fastapi-rest"):
            response = client.get("/boom")

        assert response.status_code == 500
        assert response.json() == {"error": "Internal server error"}
        logged = [
            record
            for record in caplog.records
            if record.name == "fastapi-rest"
            and record.getMessage() == "Unhandled request error:"
        ]
        assert len(logged) == 1


class TestApiError:
    def test_carries_the_envelopes_error_line_as_its_message_for_logs_and_tests(
        self,
    ) -> None:
        assert str(ApiError(404, {"error": "Not found"})) == "Not found"
        assert str(ApiError(503, {})) == "HTTP 503"
