# tests/unit/test_error_handler.py
#
# The error handler's mapping contract: a controller's HttpError becomes its
# exact JSON envelope; a routing 404/405 becomes the plain not-found envelope;
# anything else is logged once and answered with the generic 500. No database
# — the responses come from the test client of a bare app wired exactly the
# way src/app.py wires it.

import logging

import pytest
from flask import Flask

from src.lib.http_error import HttpError
from src.middleware.error_handler import register_error_handlers


def make_app() -> Flask:
    app = Flask(__name__)
    app.config["PROPAGATE_EXCEPTIONS"] = False
    register_error_handlers(app)

    @app.get("/http-error")
    def raise_http_error():
        raise HttpError.validation(
            "Missing fields. Failed to create task.", {"title": ["Title is required."]}
        )

    @app.get("/not-found-error")
    def raise_not_found():
        raise HttpError.not_found("That task no longer exists.")

    @app.get("/conflict-error")
    def raise_conflict():
        raise HttpError.conflict(
            "This project still has 1 task. Delete it before deleting the project."
        )

    @app.get("/boom")
    def raise_unexpected():
        raise RuntimeError("db down")

    return app


@pytest.fixture()
def client():
    return make_app().test_client()


class TestErrorHandler:
    def test_maps_an_http_error_to_its_own_status_and_payload_untouched(self, client):
        response = client.get("/http-error")

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"title": ["Title is required."]},
        }

    def test_maps_a_404_http_error_to_the_plain_envelope(self, client):
        response = client.get("/not-found-error")

        assert response.status_code == 404
        assert response.get_json() == {"error": "That task no longer exists."}

    def test_maps_a_409_http_error_to_the_reference_guard_message(self, client):
        response = client.get("/conflict-error")

        assert response.status_code == 409
        assert response.get_json() == {
            "error": "This project still has 1 task. "
            "Delete it before deleting the project."
        }

    def test_answers_an_unmatched_path_with_the_json_not_found_envelope(self, client):
        response = client.get("/does-not-exist")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Not found"}
        assert response.content_type.startswith("application/json")

    def test_answers_a_method_mismatch_as_404_like_the_express_fall_through(
        self, client
    ):
        # The express variant has no method matching: a wrong-method request
        # falls through its routes to the not-found middleware. Same envelope
        # here, so a client sees the same outcome from both variants.
        response = client.post("/http-error")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Not found"}

    def test_logs_an_unknown_error_once_and_answers_the_generic_500(
        self, client, caplog
    ):
        with caplog.at_level(logging.ERROR):
            response = client.get("/boom")

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}

        errors = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert len(errors) == 1
        assert "Unhandled request error" in errors[0].message


class TestHttpError:
    def test_carries_the_envelopes_error_line_as_its_message_for_logs_and_tests(self):
        assert str(HttpError(404, {"error": "Not found"})) == "Not found"
        assert str(HttpError(503, {})) == "HTTP 503"
