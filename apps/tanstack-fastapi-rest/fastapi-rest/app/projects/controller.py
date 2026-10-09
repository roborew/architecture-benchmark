# app/projects/controller.py
#
# The controller layer: validates the request, translates it into a model
# call, and returns the model's result as the response payload. It knows the
# raw request bags (query params, JSON bodies, path ids — plain dicts and
# strings) and nothing about SQL or FastAPI; the model knows SQL and nothing
# about HTTP; the routes know FastAPI and nothing about either.
#
# Validation lives in app/projects/validator.py (bodies) and
# app/lib/query_validator.py (q / :id); the board's task-list params are
# validated by the tasks domain's pure validator, because the board's rows
# are task rows. Failures are raised as ApiError and mapped to their JSON
# envelope by app/errors.py; successes are returned here, including the
# `redirectTo` the reference's actions return, which is where the SPA
# navigates next.

from __future__ import annotations

from typing import Any

from app.lib.http_error import ApiError
from app.lib.mutation import MutationResult
from app.lib.query_validator import parse_id_param, parse_search_term
from app.tasks.schemas import ProjectTaskRow
from app.tasks.validator import parse_project_task_list_query

from .model import (
    PROJECT_DELETE_MISSING,
    PROJECT_DELETE_RESTRICTED,
    PROJECT_UPDATE_MISSING,
    ProjectsModel,
)
from .schemas import Project
from .validator import parse_project_body


def _require_id(raw: Any) -> int:
    """The `{id}` a detail/update/delete URL names, or a 400 envelope."""
    id, error = parse_id_param(raw)

    if error is not None:
        raise ApiError(400, {"error": error})

    return id


class ProjectsController:
    """Maps the projects surface's requests onto model calls."""

    def __init__(self, model: ProjectsModel) -> None:
        self._model = model

    async def list(self, query: dict[str, Any]) -> list[Project]:
        """GET /api/projects — every project with its aggregate counts."""
        term, error = parse_search_term(query.get("q"))

        if error is not None:
            raise ApiError(400, {"error": error})

        return await self._model.list(term)

    async def get(self, id: Any) -> Project:
        """GET /api/projects/{id} — one project with the same shape `list` returns."""
        project = await self._model.get(_require_id(id))

        if project is None:
            raise ApiError.not_found("Not found")

        return project

    async def list_tasks(self, id: Any, query: dict[str, Any]) -> list[ProjectTaskRow]:
        """GET /api/projects/{id}/tasks — one keyset page of a project's board."""
        filters, error = parse_project_task_list_query(query)

        if error is not None:
            raise ApiError(400, {"error": error})

        return await self._model.list_tasks(_require_id(id), filters)

    async def create(self, body: Any) -> MutationResult:
        """POST /api/projects — insert one project, redirect to its board."""
        parsed, errors = parse_project_body(body)

        if errors is not None:
            raise ApiError.validation(
                "Missing fields. Failed to create project.", errors
            )

        created = await self._model.create(parsed)

        return MutationResult(
            ok=True,
            message="Project created.",
            redirect_to=f"/projects/{created}",
        )

    async def update(self, id: Any, body: Any) -> MutationResult:
        """PATCH /api/projects/{id} — update one project by primary key."""
        project_id = _require_id(id)
        parsed, errors = parse_project_body(body)

        if errors is not None:
            raise ApiError.validation(
                "Missing fields. Failed to update project.", errors
            )

        result = await self._model.update(project_id, parsed)

        if result == PROJECT_UPDATE_MISSING:
            raise ApiError.not_found("That project no longer exists.")

        return MutationResult(
            ok=True,
            message="Project updated.",
            redirect_to=f"/projects/{project_id}",
        )

    async def remove(self, id: Any) -> MutationResult:
        """DELETE /api/projects/{id} — delete one project, or 409 while it
        has tasks."""
        result, message = await self._model.remove(_require_id(id))

        if result == PROJECT_DELETE_MISSING:
            raise ApiError.not_found("That project no longer exists.")

        if result == PROJECT_DELETE_RESTRICTED:
            # A project that still has tasks cannot be removed (FK RESTRICT);
            # the reference reports why as an actionable message, which this
            # API answers as a 409 with the same string.
            raise ApiError.conflict(message)

        return MutationResult(
            ok=True,
            message="Project deleted.",
            redirect_to="/projects",
        )
