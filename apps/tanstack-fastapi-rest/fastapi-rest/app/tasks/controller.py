# app/tasks/controller.py
#
# The controller layer: validates the request, translates it into a model
# call, and returns the model's result as the response payload. It knows the
# raw request bags (query params, JSON bodies, path ids — plain dicts and
# strings) and nothing about SQL or FastAPI; the model knows SQL and nothing
# about HTTP; the routes know FastAPI and nothing about either.
#
# Validation lives in app/tasks/validator.py (pure) and the body-field errors
# it produces are the reference variant's message strings verbatim. Failures
# are raised as ApiError and mapped to their JSON envelope by
# app/errors.py; successes are returned here, including the `redirectTo` the
# reference's actions return, which is where the SPA navigates next.

from __future__ import annotations

from typing import Any

from app.lib.http_error import ApiError
from app.lib.mutation import MutationResult
from app.lib.query_validator import parse_id_param

from .model import (
    ADD_COMMENT_AUTHOR_MISSING,
    ADD_COMMENT_TASK_MISSING,
    TASK_UPDATE_ASSIGNEE_MISSING,
    TASK_UPDATE_MISSING,
    TaskCreateInput,
    TasksModel,
    TaskUpdateInput,
    WithCommentInput,
)
from .schemas import Comment, CountResult, Task, TaskRow
from .validator import (
    parse_comment_body,
    parse_create_task_refs,
    parse_task_fields,
    parse_task_list_query,
    parse_update_assignee,
    parse_with_comment_fields,
)


def _require_id(raw: Any) -> int:
    """The `{id}` a detail/update/delete URL names, or a 400 envelope."""
    id, error = parse_id_param(raw)

    if error is not None:
        raise ApiError(400, {"error": error})

    return id


class TasksController:
    """Maps the tasks surface's requests onto model calls."""

    def __init__(self, model: TasksModel) -> None:
        self._model = model

    async def list(self, query: dict[str, Any]) -> list[TaskRow]:
        """GET /api/tasks — the workspace-wide task list, one keyset page."""
        filters, error = parse_task_list_query(query)

        if error is not None:
            raise ApiError(400, {"error": error})

        return await self._model.list(filters)

    async def count(self, query: dict[str, Any]) -> CountResult:
        """GET /api/tasks/count — how many tasks match the list's filters."""
        # The count shares the list's filters; cursor/limit are list-paging
        # params and are simply not part of a count, so they are ignored here
        # rather than rejected.
        filters, error = parse_task_list_query(query)

        if error is not None:
            raise ApiError(400, {"error": error})

        return CountResult(count=await self._model.count(filters))

    async def get(self, id: Any) -> Task:
        """GET /api/tasks/{id} — one task with its project and assignee names."""
        task = await self._model.get(_require_id(id))

        if task is None:
            raise ApiError.not_found("Not found")

        return task

    async def list_comments(self, id: Any) -> list[Comment]:
        """GET /api/tasks/{id}/comments — the 10 most recent comments on one task."""
        return await self._model.list_comments(_require_id(id))

    async def create(self, body: Any) -> MutationResult:
        """POST /api/tasks — insert one task, redirect to its detail page."""
        fields, fields_errors = parse_task_fields(body)

        if fields_errors is not None:
            raise ApiError.validation(
                "Missing fields. Failed to create task.", fields_errors
            )

        refs, refs_errors = parse_create_task_refs(body)

        if refs_errors is not None:
            raise ApiError.validation(
                "Missing fields. Failed to create task.", refs_errors
            )

        # Only once the shape of the fields is known to be good does it make
        # sense to ask the database whether the referenced rows exist.
        resolved = await self._model.resolve_refs(refs.project_id, refs.assignee_id)

        if resolved:
            raise ApiError.validation(
                "Missing fields. Failed to create task.", resolved
            )

        created = await self._model.create(
            TaskCreateInput(
                project_id=refs.project_id,
                assignee_id=refs.assignee_id,
                title=fields.title,
                description=fields.description,
                status=fields.status,
            )
        )

        return MutationResult(
            ok=True,
            message="Task created.",
            redirect_to=f"/tasks/{created}",
        )

    async def create_with_comment(self, body: Any) -> MutationResult:
        """POST /api/tasks/with-comment — one transaction: a task and its first comment."""
        # The comment has its own bound (char_length BETWEEN 1 AND 1000),
        # enforced by its own schema so the message lands on the comment field.
        fields, fields_errors = parse_task_fields(body)

        if fields_errors is not None:
            raise ApiError.validation(
                "Missing fields. Failed to create the task.", fields_errors
            )

        comment, comment_errors = parse_with_comment_fields(body)

        if comment_errors is not None:
            raise ApiError.validation(
                "Missing fields. Failed to create the task.", comment_errors
            )

        refs, refs_errors = parse_create_task_refs(body)

        if refs_errors is not None:
            raise ApiError.validation(
                "Missing fields. Failed to create the task.", refs_errors
            )

        resolved = await self._model.resolve_refs(refs.project_id, refs.assignee_id)

        if resolved:
            raise ApiError.validation(
                "Missing fields. Failed to create the task.", resolved
            )

        status, created = await self._model.create_with_comment(
            WithCommentInput(
                project_id=refs.project_id,
                assignee_id=refs.assignee_id,
                title=fields.title,
                description=fields.description,
                status=fields.status,
                comment_body=comment.comment_body,
                comment_author_id=comment.comment_author_id,
            )
        )

        if status == "author-missing":
            # Filed under assigneeId verbatim from the reference: its form has
            # one person select, so a bad author landed on the same field the
            # assignee errors land on. The message string is the contract; the
            # key follows it so a client renders both identically.
            raise ApiError.validation(
                "Missing fields. Failed to create the task.",
                {"assigneeId": ["That comment author no longer exists."]},
            )

        return MutationResult(
            ok=True,
            message="Task created.",
            redirect_to=f"/tasks/{created}",
        )

    async def update(self, id: Any, body: Any) -> MutationResult:
        """PATCH /api/tasks/{id} — update one task by primary key."""
        task_id = _require_id(id)

        fields, fields_errors = parse_task_fields(body)

        if fields_errors is not None:
            raise ApiError.validation(
                "Missing fields. Failed to update task.", fields_errors
            )

        # The project is deliberately not updatable here: spec/contract.md
        # lists the update form's fields as title, status, assignee and
        # description — a task belongs to its project for its lifetime.
        assignee_id, assignee_errors = parse_update_assignee(body)

        if assignee_errors is not None:
            raise ApiError.validation(
                "Missing fields. Failed to update task.", assignee_errors
            )

        result = await self._model.update(
            task_id,
            TaskUpdateInput(
                title=fields.title,
                description=fields.description,
                status=fields.status,
                assignee_id=assignee_id,
            ),
        )

        if result == TASK_UPDATE_ASSIGNEE_MISSING:
            raise ApiError.validation(
                "Missing fields. Failed to update task.",
                {"assigneeId": ["That assignee no longer exists."]},
            )

        if result == TASK_UPDATE_MISSING:
            raise ApiError.not_found("That task no longer exists.")

        return MutationResult(
            ok=True,
            message="Task updated.",
            redirect_to=f"/tasks/{task_id}",
        )

    async def remove(self, id: Any) -> MutationResult:
        """DELETE /api/tasks/{id} — delete one task; its comments cascade with it."""
        task_id = _require_id(id)
        project_id = await self._model.remove(task_id)

        if project_id is None:
            raise ApiError.not_found("That task no longer exists.")

        # Straight to the board: the detail page for this id is now not-found,
        # so redirecting there would land the user on a dead URL.
        return MutationResult(
            ok=True,
            message="Task deleted.",
            redirect_to=f"/projects/{project_id}",
        )

    async def add_comment(self, id: Any, body: Any) -> MutationResult:
        """POST /api/tasks/{id}/comments — add one comment to an existing task."""
        task_id = _require_id(id)
        parsed, errors = parse_comment_body(body)

        if errors is not None:
            raise ApiError.validation(
                "Missing fields. Failed to add the comment.", errors
            )

        result = await self._model.add_comment(task_id, parsed.body, parsed.author_id)

        if result == ADD_COMMENT_TASK_MISSING:
            raise ApiError.not_found("That task no longer exists.")

        if result == ADD_COMMENT_AUTHOR_MISSING:
            raise ApiError.validation(
                "Missing fields. Failed to add the comment.",
                {"authorId": ["That comment author no longer exists."]},
            )

        # No redirect, mirroring the reference's createComment return exactly:
        # the user stays on the task detail page and sees the comment they just
        # wrote in the list above the form, so there is no `redirectTo` (and no
        # message) to return — `ok: true` is the whole reply.
        return MutationResult(ok=True)
