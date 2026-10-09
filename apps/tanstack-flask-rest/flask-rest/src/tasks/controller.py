# src/tasks/tasks.controller.py
#
# The controller layer: validates the request, translates it into a model
# call, and decides the response — the status plus the exact JSON payload. It
# knows neither SQL nor Flask: the routing layer hands it plain values and
# jsonifies what it returns; the model knows SQL and nothing about HTTP.
#
# Validation lives in src/tasks/tasks.validator.py (pure) and the body-field
# errors it produces are the reference variant's message strings verbatim.
# Failures are raised as HttpError and mapped to their JSON envelope by the
# error handler; the successes include the `redirectTo` the reference's
# actions return, which is where the SPA navigates next.

from collections.abc import Mapping, Sequence
from typing import Any

from src.lib.http_error import HttpError
from src.lib.query_validator import QueryParamError, parse_id_param
from src.lib.validation import BodyErrors
from src.tasks.model import (
    TaskCreateInput,
    TasksModel,
    TaskUpdateInput,
    WithCommentInput,
)
from src.tasks.validator import (
    parse_comment_body,
    parse_create_task_refs,
    parse_task_fields,
    parse_task_list_query,
    parse_update_assignee,
    parse_with_comment_fields,
)

#: What a controller hands back to the routing layer: status + JSON payload.
ActionResult = tuple[int, Any]


def _require_id(raw: str | None) -> int:
    """The `:id` a detail/update/delete URL names, or a 400 envelope."""
    try:
        return parse_id_param(raw)
    except QueryParamError as error:
        raise HttpError(400, {"error": str(error)}) from None


class TasksController:
    def __init__(self, model: TasksModel) -> None:
        self._model = model

    def list(self, query: Mapping[str, Sequence[str]]) -> ActionResult:
        """GET /api/tasks — the workspace-wide task list, one keyset page."""
        try:
            filters = parse_task_list_query(query)
        except QueryParamError as error:
            raise HttpError(400, {"error": str(error)}) from None

        tasks = self._model.list(filters)
        return 200, tasks

    def count(self, query: Mapping[str, Sequence[str]]) -> ActionResult:
        """GET /api/tasks/count — how many tasks match the list's filters.

        The count shares the list's filters; cursor/limit are list-paging
        params and are simply not part of a count, so they are ignored here
        rather than rejected.
        """
        try:
            filters = parse_task_list_query(query)
        except QueryParamError as error:
            raise HttpError(400, {"error": str(error)}) from None

        count = self._model.count(filters)
        return 200, {"count": count}

    def get(self, id: str | None) -> ActionResult:
        """GET /api/tasks/:id — one task with its project and assignee names."""
        task = self._model.get(_require_id(id))

        if task is None:
            raise HttpError.not_found("Not found")

        return 200, task

    def list_comments(self, id: str | None) -> ActionResult:
        """GET /api/tasks/:id/comments — the 10 most recent comments."""
        comments = self._model.list_comments(_require_id(id))
        return 200, comments

    def create(self, body: Any) -> ActionResult:
        """POST /api/tasks — insert one task, redirect to its detail page."""
        fields = parse_task_fields(body)

        if isinstance(fields, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to create task.", fields.errors
            )

        refs = parse_create_task_refs(body)

        if isinstance(refs, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to create task.", refs.errors
            )

        # Only once the shape of the fields is known to be good does it make
        # sense to ask the database whether the referenced rows exist.
        project_id, assignee_id = refs
        ref_errors = self._model.resolve_refs(project_id, assignee_id)

        if ref_errors:
            raise HttpError.validation(
                "Missing fields. Failed to create task.", ref_errors
            )

        created_id = self._model.create(
            TaskCreateInput(
                project_id=project_id,
                assignee_id=assignee_id,
                title=fields.title,
                description=fields.description,
                status=fields.status,
            )
        )

        return 201, {
            "ok": True,
            "message": "Task created.",
            "redirectTo": f"/tasks/{created_id}",
        }

    def create_with_comment(self, body: Any) -> ActionResult:
        """POST /api/tasks/with-comment — one transaction: a task and its
        first comment.

        The comment has its own bound (char_length BETWEEN 1 AND 1000),
        enforced by its own schema so the message lands on the comment field.
        """
        fields = parse_task_fields(body)

        if isinstance(fields, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to create the task.", fields.errors
            )

        comment = parse_with_comment_fields(body)

        if isinstance(comment, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to create the task.", comment.errors
            )

        refs = parse_create_task_refs(body)

        if isinstance(refs, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to create the task.", refs.errors
            )

        project_id, assignee_id = refs
        ref_errors = self._model.resolve_refs(project_id, assignee_id)

        if ref_errors:
            raise HttpError.validation(
                "Missing fields. Failed to create the task.", ref_errors
            )

        created = self._model.create_with_comment(
            WithCommentInput(
                task=TaskCreateInput(
                    project_id=project_id,
                    assignee_id=assignee_id,
                    title=fields.title,
                    description=fields.description,
                    status=fields.status,
                ),
                comment_body=comment.comment_body,
                comment_author_id=comment.comment_author_id,
            )
        )

        if created == "author-missing":
            # Filed under assigneeId verbatim from the reference: its form has
            # one person select, so a bad author landed on the same field the
            # assignee errors land on. The message string is the contract; the
            # key follows it so a client renders both identically.
            raise HttpError.validation(
                "Missing fields. Failed to create the task.",
                {"assigneeId": ["That comment author no longer exists."]},
            )

        return 201, {
            "ok": True,
            "message": "Task created.",
            "redirectTo": f"/tasks/{created}",
        }

    def update(self, id: str | None, body: Any) -> ActionResult:
        """PATCH /api/tasks/:id — update one task by primary key."""
        row_id = _require_id(id)

        fields = parse_task_fields(body)

        if isinstance(fields, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to update task.", fields.errors
            )

        # The project is deliberately not updatable here: spec/contract.md
        # lists the update form's fields as title, status, assignee and
        # description — a task belongs to its project for its lifetime.
        assignee_id = parse_update_assignee(body)

        if isinstance(assignee_id, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to update task.", assignee_id.errors
            )

        result = self._model.update(
            row_id,
            TaskUpdateInput(
                title=fields.title,
                description=fields.description,
                status=fields.status,
                assignee_id=assignee_id,
            ),
        )

        if result == "assignee-missing":
            raise HttpError.validation(
                "Missing fields. Failed to update task.",
                {"assigneeId": ["That assignee no longer exists."]},
            )

        if result == "missing":
            raise HttpError.not_found("That task no longer exists.")

        return 200, {
            "ok": True,
            "message": "Task updated.",
            "redirectTo": f"/tasks/{row_id}",
        }

    def remove(self, id: str | None) -> ActionResult:
        """DELETE /api/tasks/:id — delete one task; its comments cascade."""
        row_id = _require_id(id)
        project_id = self._model.remove(row_id)

        if project_id is None:
            raise HttpError.not_found("That task no longer exists.")

        # Straight to the board: the detail page for this id is now not-found,
        # so redirecting there would land the user on a dead URL.
        return 200, {
            "ok": True,
            "message": "Task deleted.",
            "redirectTo": f"/projects/{project_id}",
        }

    def add_comment(self, id: str | None, body: Any) -> ActionResult:
        """POST /api/tasks/:id/comments — add one comment to a task."""
        row_id = _require_id(id)
        parsed = parse_comment_body(body)

        if isinstance(parsed, BodyErrors):
            raise HttpError.validation(
                "Missing fields. Failed to add the comment.", parsed.errors
            )

        result = self._model.add_comment(row_id, parsed.body, parsed.author_id)

        if result == "task-missing":
            raise HttpError.not_found("That task no longer exists.")

        if result == "author-missing":
            raise HttpError.validation(
                "Missing fields. Failed to add the comment.",
                {"authorId": ["That comment author no longer exists."]},
            )

        # No redirect, mirroring the reference's createComment return exactly:
        # the user stays on the task detail page and sees the comment they just
        # wrote in the list above the form, so there is no `redirectTo` (and no
        # message) to return — `ok: true` is the whole reply.
        return 201, {"ok": True}
