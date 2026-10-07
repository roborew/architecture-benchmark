# app/users/controller.py
#
# The controller layer: validates the request, translates it into a model
# call, and returns the model's result as the response payload. It knows the
# raw request bags (query params, JSON bodies, path ids — plain dicts and
# strings) and nothing about SQL or FastAPI; the model knows SQL and nothing
# about HTTP; the routes know FastAPI and nothing about either.
#
# Validation lives in app/users/validator.py (bodies) and
# app/lib/query_validator.py (q / :id). Failures are raised as ApiError and
# mapped to their JSON envelope by app/errors.py; successes are returned
# here, including the `redirectTo` the reference's actions return, which is
# where the SPA navigates next.

from __future__ import annotations

from typing import Any

from app.lib.http_error import ApiError
from app.lib.mutation import MutationResult
from app.lib.query_validator import parse_id_param, parse_search_term
from app.tasks.schemas import Task

from .model import (
    USER_DELETE_MISSING,
    USER_DELETE_RESTRICTED,
    USER_UPDATE_MISSING,
    UsersModel,
)
from .schemas import User
from .validator import parse_user_body


def _require_id(raw: Any) -> int:
    """The `{id}` a detail/update/delete URL names, or a 400 envelope."""
    id, error = parse_id_param(raw)

    if error is not None:
        raise ApiError(400, {"error": error})

    return id


class UsersController:
    """Maps the users surface's requests onto model calls."""

    def __init__(self, model: UsersModel) -> None:
        self._model = model

    async def list(self, query: dict[str, Any]) -> list[User]:
        """GET /api/users?q=… — the People listing page's rows."""
        term, error = parse_search_term(query.get("q"))

        if error is not None:
            raise ApiError(400, {"error": error})

        return await self._model.list(term)

    async def get(self, id: Any) -> User:
        """GET /api/users/{id} — one member with the same shape `list` returns."""
        user = await self._model.get(_require_id(id))

        if user is None:
            raise ApiError.not_found("Not found")

        return user

    async def list_tasks(self, id: Any) -> list[Task]:
        """GET /api/users/{id}/tasks — the tasks assigned to one member."""
        return await self._model.list_tasks(_require_id(id))

    async def create(self, body: Any) -> MutationResult:
        """POST /api/users — insert one member, redirect to their page."""
        parsed, errors = parse_user_body(body)

        if errors is not None:
            raise ApiError.validation("Missing fields. Failed to create user.", errors)

        created = await self._model.create(parsed)

        return MutationResult(
            ok=True,
            message="User created.",
            redirect_to=f"/users/{created}",
        )

    async def update(self, id: Any, body: Any) -> MutationResult:
        """PATCH /api/users/{id} — update one member by primary key."""
        user_id = _require_id(id)
        parsed, errors = parse_user_body(body)

        if errors is not None:
            raise ApiError.validation("Missing fields. Failed to update user.", errors)

        result = await self._model.update(user_id, parsed)

        if result == USER_UPDATE_MISSING:
            raise ApiError.not_found("That user no longer exists.")

        return MutationResult(
            ok=True,
            message="User updated.",
            redirect_to=f"/users/{user_id}",
        )

    async def remove(self, id: Any) -> MutationResult:
        """DELETE /api/users/{id} — delete one member, or 409 while they
        authored comments."""
        result, message = await self._model.remove(_require_id(id))

        if result == USER_DELETE_MISSING:
            raise ApiError.not_found("That user no longer exists.")

        if result == USER_DELETE_RESTRICTED:
            # A member who has authored comments cannot be removed (FK
            # RESTRICT); the reference reports why as an actionable message,
            # which this API answers as a 409 with the same string.
            raise ApiError.conflict(message)

        return MutationResult(
            ok=True,
            message="User deleted.",
            redirect_to="/users",
        )
