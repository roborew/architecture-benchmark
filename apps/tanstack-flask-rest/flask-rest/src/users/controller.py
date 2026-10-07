# src/users/users.controller.py
#
# The controller layer: validates the request, translates it into a model
# call, and decides the response — the status plus the exact JSON payload. It
# knows neither SQL nor Flask: the routing layer hands it plain values (the
# raw query values, the parsed body, the raw route param) and jsonifies what
# it returns; the model knows SQL and nothing about HTTP. Failures are raised
# as HttpError and mapped to their JSON envelope by the error handler.
#
# Validation lives in src/users/users.validator.py (bodies) and
# src/lib/query_validator.py (q / :id). The successes include the `redirectTo`
# the reference's actions return, which is where the SPA navigates next.

from collections.abc import Sequence
from typing import Any

from src.lib.http_error import HttpError
from src.lib.query_validator import QueryParamError, parse_id_param, parse_search_term
from src.lib.validation import BodyErrors
from src.users.model import DeleteRestricted, UsersModel
from src.users.validator import parse_user_body

#: What a controller hands back to the routing layer: status + JSON payload.
ActionResult = tuple[int, Any]


def _require_id(raw: str | None) -> int:
    """The `:id` a detail/update/delete URL names, or a 400 envelope."""
    try:
        return parse_id_param(raw)
    except QueryParamError as error:
        raise HttpError(400, {"error": str(error)}) from None


class UsersController:
    def __init__(self, model: UsersModel) -> None:
        self._model = model

    def list(self, q_values: Sequence[str]) -> ActionResult:
        """GET /api/users?q=... — the People listing page's rows."""
        try:
            term = parse_search_term(q_values)
        except QueryParamError as error:
            raise HttpError(400, {"error": str(error)}) from None

        users = self._model.list(term)
        return 200, users

    def get(self, id: str | None) -> ActionResult:
        """GET /api/users/:id — one member with the same shape list returns."""
        user = self._model.get(_require_id(id))

        if user is None:
            raise HttpError.not_found("Not found")

        return 200, user

    def list_tasks(self, id: str | None) -> ActionResult:
        """GET /api/users/:id/tasks — the tasks assigned to one member."""
        tasks = self._model.list_tasks(_require_id(id))
        return 200, tasks

    def create(self, body: Any) -> ActionResult:
        """POST /api/users — insert one member, redirect to their page."""
        parsed = parse_user_body(body)

        if isinstance(parsed, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to create user.", parsed.errors
            )

        created_id = self._model.create(parsed)

        return 201, {
            "ok": True,
            "message": "User created.",
            "redirectTo": f"/users/{created_id}",
        }

    def update(self, id: str | None, body: Any) -> ActionResult:
        """PATCH /api/users/:id — update one member by primary key."""
        row_id = _require_id(id)
        parsed = parse_user_body(body)

        if isinstance(parsed, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to update user.", parsed.errors
            )

        result = self._model.update(row_id, parsed)

        if result == "missing":
            raise HttpError.not_found("That user no longer exists.")

        return 200, {
            "ok": True,
            "message": "User updated.",
            "redirectTo": f"/users/{row_id}",
        }

    def remove(self, id: str | None) -> ActionResult:
        """DELETE /api/users/:id — delete one member, or 409 while they
        authored comments."""
        row_id = _require_id(id)
        result = self._model.remove(row_id)

        if result == "missing":
            raise HttpError.not_found("That user no longer exists.")

        if isinstance(result, DeleteRestricted):
            # A member who has authored comments cannot be removed (FK
            # RESTRICT); the reference reports why as an actionable message,
            # which this API answers as a 409 with the same string.
            raise HttpError.conflict(result.message)

        return 200, {
            "ok": True,
            "message": "User deleted.",
            "redirectTo": "/users",
        }
