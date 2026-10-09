# src/projects/projects.controller.py
#
# The controller layer: validates the request, translates it into a model
# call, and decides the response — the status plus the exact JSON payload. It
# knows neither SQL nor Flask: the routing layer hands it plain values and
# jsonifies what it returns; the model knows SQL and nothing about HTTP.
#
# Validation lives in src/projects/projects.validator.py (bodies) and
# src/lib/query_validator.py (q / :id); the board's task-list params are
# validated by the tasks domain's pure validator, because the board's rows are
# task rows. Failures are raised as HttpError and mapped to their JSON
# envelope by the error handler; the successes include the `redirectTo` the
# reference's actions return, which is where the SPA navigates next.

from collections.abc import Mapping, Sequence
from typing import Any

from src.lib.http_error import HttpError
from src.lib.query_validator import QueryParamError, parse_id_param, parse_search_term
from src.lib.validation import BodyErrors
from src.projects.model import DeleteRestricted, ProjectsModel
from src.projects.validator import parse_project_body
from src.tasks.validator import parse_project_task_list_query

#: What a controller hands back to the routing layer: status + JSON payload.
ActionResult = tuple[int, Any]


def _require_id(raw: str | None) -> int:
    """The `:id` a detail/update/delete URL names, or a 400 envelope."""
    try:
        return parse_id_param(raw)
    except QueryParamError as error:
        raise HttpError(400, {"error": str(error)}) from None


class ProjectsController:
    def __init__(self, model: ProjectsModel) -> None:
        self._model = model

    def list(self, q_values: Sequence[str]) -> ActionResult:
        """GET /api/projects — every project with its aggregate counts."""
        try:
            term = parse_search_term(q_values)
        except QueryParamError as error:
            raise HttpError(400, {"error": str(error)}) from None

        projects = self._model.list(term)
        return 200, projects

    def get(self, id: str | None) -> ActionResult:
        """GET /api/projects/:id — one project with the same shape list
        returns."""
        project = self._model.get(_require_id(id))

        if project is None:
            raise HttpError.not_found("Not found")

        return 200, project

    def list_tasks(
        self, id: str | None, query: Mapping[str, Sequence[str]]
    ) -> ActionResult:
        """GET /api/projects/:id/tasks — one keyset page of a project's
        board."""
        project_id = _require_id(id)

        try:
            filters = parse_project_task_list_query(query)
        except QueryParamError as error:
            raise HttpError(400, {"error": str(error)}) from None

        tasks = self._model.list_tasks(project_id, filters)
        return 200, tasks

    def create(self, body: Any) -> ActionResult:
        """POST /api/projects — insert one project, redirect to its board."""
        parsed = parse_project_body(body)

        if isinstance(parsed, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to create project.", parsed.errors
            )

        created_id = self._model.create(parsed)

        return 201, {
            "ok": True,
            "message": "Project created.",
            "redirectTo": f"/projects/{created_id}",
        }

    def update(self, id: str | None, body: Any) -> ActionResult:
        """PATCH /api/projects/:id — update one project by primary key."""
        project_id = _require_id(id)
        parsed = parse_project_body(body)

        if isinstance(parsed, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to update project.", parsed.errors
            )

        result = self._model.update(project_id, parsed)

        if result == "missing":
            raise HttpError.not_found("That project no longer exists.")

        return 200, {
            "ok": True,
            "message": "Project updated.",
            "redirectTo": f"/projects/{project_id}",
        }

    def remove(self, id: str | None) -> ActionResult:
        """DELETE /api/projects/:id — delete one project, or 409 while it has
        tasks."""
        project_id = _require_id(id)
        result = self._model.remove(project_id)

        if result == "missing":
            raise HttpError.not_found("That project no longer exists.")

        if isinstance(result, DeleteRestricted):
            # A project that still has tasks cannot be removed (FK RESTRICT);
            # the reference reports why as an actionable message, which this
            # API answers as a 409 with the same string.
            raise HttpError.conflict(result.message)

        return 200, {
            "ok": True,
            "message": "Project deleted.",
            "redirectTo": "/projects",
        }
