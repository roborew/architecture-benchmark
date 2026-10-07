# app/tasks/validator.py
#
# Input validation for the tasks surface, kept pure so it can be unit tested
# without FastAPI: the list query params (status/projectId/assigneeId/cursor/
# limit), and the JSON bodies of every write. The controller maps an error
# case onto the JSON 400 envelope; the model never sees an invalid value.
#
# The rules and their message strings are ported verbatim from the reference
# variant's actions.ts (TaskSchema / CommentSchema — zod schemas), so a client
# that rendered the reference app's validation errors renders ours unchanged.
# A JSON body's absent field is normalised to None before parsing: the
# reference parses FormData, where a field the form did not submit reads back
# as null, and zod's own messages ("Invalid input: expected string, received
# null") are part of that contract.

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.lib.fields import (
    coerced_positive_int as _coerced_positive_int,
)
from app.lib.fields import (
    is_js_integer,
)
from app.lib.fields import (
    is_string as _is_string,
)
from app.lib.fields import (
    js_number as _js_number,
)
from app.lib.fields import (
    zod_type_error as _type_error,
)

# The stored status values (spec/contract.md) — identical to the reference's.
TASK_STATUSES = ("todo", "in progress", "done")

TaskStatus = str


@dataclass(frozen=True, slots=True)
class TaskFields:
    title: str
    description: str
    status: TaskStatus


@dataclass(frozen=True, slots=True)
class WithCommentFields:
    comment_body: str
    comment_author_id: int


@dataclass(frozen=True, slots=True)
class CommentBodyFields:
    body: str
    author_id: int


@dataclass(frozen=True, slots=True)
class TaskListFilters:
    search: str
    status: str
    project_id: int | None = None
    assignee_id: int | None = None
    cursor: str | None = None
    # Raw limit; the model clamps it to [1, 26] as the reference does.
    limit: int | None = None


@dataclass(frozen=True, slots=True)
class ProjectTaskFilters:
    status: str
    cursor: str | None = None
    limit: int | None = None


@dataclass(frozen=True, slots=True)
class TaskRefs:
    project_id: int
    assignee_id: int | None


# ---------------------------------------------------------------------------
# Field-error plumbing: the field → messages map zod's flatten() produces,
# with zod's own message strings, so a client renders ours unchanged.
# ---------------------------------------------------------------------------


from app.lib.query_validator import SIGNED_INTEGER, parse_search_term

# ---------------------------------------------------------------------------
# Read-side query params
# ---------------------------------------------------------------------------


def parse_task_status(raw: Any) -> tuple[str, None] | tuple[None, str]:
    """Parses the `status` filter: `(status, None)` or `(None, error)`.

    `status` is constrained text in the schema, so the reference's query layer
    validates it against the stored values and throws `Unknown task status: …`;
    the same message is this API's 400 envelope. Absent, empty and whitespace
    values mean "every status". A repeated param arrives as a list and is
    rejected, like `q`.
    """
    if raw is None:
        return "", None

    if not isinstance(raw, str):
        return None, "status must be a single value"

    term = raw.strip()

    if term and term not in TASK_STATUSES:
        return None, f"Unknown task status: {term}"

    return term, None


def parse_single_string(
    raw: Any, name: str
) -> tuple[str | None, None] | tuple[None, str]:
    """A single-value string param; absent is fine, a list is a client bug."""
    if raw is None:
        return None, None

    if not isinstance(raw, str):
        return None, f"{name} must be a single value"

    return raw, None


def parse_integer_param(
    raw: Any, name: str
) -> tuple[int | None, None] | tuple[None, str]:
    """An integer filter param (`projectId`/`assigneeId`/`limit`)."""
    if raw is None:
        return None, None

    # A repeated param arrives as a list; like `q`, picking one of the two
    # values would hide the client bug.
    if not isinstance(raw, str):
        return None, f"{name} must be a single value"

    if not SIGNED_INTEGER.match(raw):
        return None, f"{name} must be an integer"

    return int(raw), None


def parse_task_list_query(
    query: dict[str, Any],
) -> tuple[TaskListFilters, None] | tuple[None, str]:
    """Parses the workspace list's query params: `q` searches title/description,
    `status`/`projectId`/`assigneeId` filter, `cursor`/`limit` page.

    Validation order is fixed (q, status, projectId, assigneeId, cursor, limit)
    so a request with several bad params always reports the same one.
    """
    q_term, q_error = parse_search_term(query.get("q"))
    if q_error is not None:
        return None, q_error

    status, status_error = parse_task_status(query.get("status"))
    if status_error is not None:
        return None, status_error

    project_id, project_error = parse_integer_param(query.get("projectId"), "projectId")
    if project_error is not None:
        return None, project_error

    assignee_id, assignee_error = parse_integer_param(
        query.get("assigneeId"), "assigneeId"
    )
    if assignee_error is not None:
        return None, assignee_error

    cursor, cursor_error = parse_single_string(query.get("cursor"), "cursor")
    if cursor_error is not None:
        return None, cursor_error

    limit, limit_error = parse_integer_param(query.get("limit"), "limit")
    if limit_error is not None:
        return None, limit_error

    return (
        TaskListFilters(
            search=q_term,
            status=status,
            project_id=project_id,
            assignee_id=assignee_id,
            # An absent cursor is the first page; an empty one decodes to nothing.
            cursor=cursor,
            limit=limit,
        ),
        None,
    )


def parse_project_task_list_query(
    query: dict[str, Any],
) -> tuple[ProjectTaskFilters, None] | tuple[None, str]:
    """Parses a project board's query params: `status`, `cursor`, `limit` — the
    workspace list's filters minus the ones a board cannot vary (its project is
    the URL; its order is `created_at`, so no search)."""
    status, status_error = parse_task_status(query.get("status"))
    if status_error is not None:
        return None, status_error

    cursor, cursor_error = parse_single_string(query.get("cursor"), "cursor")
    if cursor_error is not None:
        return None, cursor_error

    limit, limit_error = parse_integer_param(query.get("limit"), "limit")
    if limit_error is not None:
        return None, limit_error

    return ProjectTaskFilters(status=status, cursor=cursor, limit=limit), None


# ---------------------------------------------------------------------------
# Write-side bodies (rules ported verbatim from the reference's actions.ts)
# ---------------------------------------------------------------------------


def _task_title_errors(value: Any) -> list[str]:
    # Matches the CHECK (char_length BETWEEN 1 AND 200) in spec/schema.sql,
    # so the same bound is enforced in the form and the database.
    if not _is_string(value):
        return [_type_error("string", value)]

    title = value.strip()
    if len(title) < 1:
        return ["Title is required."]
    if len(title) > 200:
        return ["Title must be 200 characters or fewer."]
    return []


def _task_description_errors(value: Any) -> list[str]:
    # An omitted description is legal (the column defaults to ''), so null —
    # which is what a field the client did not send reads back as — is
    # normalised here rather than reported as a validation failure.
    if value is None:
        return []
    if not _is_string(value):
        return [_type_error("string", value)]
    return []


def _task_status_errors(value: Any) -> list[str]:
    if value not in TASK_STATUSES:
        return ["Choose a valid status."]
    return []


def parse_task_fields(
    raw: Any,
) -> tuple[TaskFields, None] | tuple[None, dict[str, list[str]]]:
    """The task fields a create or update body submits (title/description/status)."""
    body = raw if isinstance(raw, dict) else {}

    errors: dict[str, list[str]] = {}
    title_errors = _task_title_errors(body.get("title"))
    if title_errors:
        errors["title"] = title_errors
    description_errors = _task_description_errors(body.get("description"))
    if description_errors:
        errors["description"] = description_errors
    status_errors = _task_status_errors(body.get("status"))
    if status_errors:
        errors["status"] = status_errors

    if errors:
        return None, errors

    description = body.get("description")
    return (
        TaskFields(
            title=body["title"].strip(),
            description=(description.strip() if isinstance(description, str) else ""),
            status=body["status"],
        ),
        None,
    )


def parse_create_task_refs(
    raw: dict[str, Any] | Any,
) -> tuple[TaskRefs, None] | tuple[None, dict[str, list[str]]]:
    """The pure half of the reference's `resolveRefs`: which ids could name a row.

    `assigneeId` is nullable, and spec/contract.md gives exactly one way to
    unassign — an explicit empty choice — so absent, null and "" all mean
    "unassigned" rather than invalid. Everything else must be an integer; the
    database half (does the row exist) is the model's, run only once the shape
    is known to be good.
    """
    body = raw if isinstance(raw, dict) else {}

    project_id = (
        None if body.get("projectId") is None else _js_number(body["projectId"])
    )
    if project_id is not None and not is_js_integer(project_id):
        project_id = None  # NaN or fractional: no row can be named

    assignee_raw = body.get("assigneeId")
    if assignee_raw is None or assignee_raw == "":
        assignee_id: int | None = None
    else:
        number = _js_number(assignee_raw)
        assignee_id = None if not is_js_integer(number) else int(number)

    errors: dict[str, list[str]] = {}

    if project_id is None:
        errors["projectId"] = ["Choose a project."]

    if assignee_id is None and assignee_raw is not None and assignee_raw != "":
        errors["assigneeId"] = ["Choose a valid assignee."]

    if errors:
        return None, errors

    return TaskRefs(project_id=project_id, assignee_id=assignee_id), None


def parse_update_assignee(
    raw: dict[str, Any] | Any,
) -> tuple[int | None, None] | tuple[None, dict[str, list[str]]]:
    """The update body's assignee: the same rule as `parse_create_task_refs`, alone."""
    body = raw if isinstance(raw, dict) else {}

    assignee_raw = body.get("assigneeId")
    if assignee_raw is None or assignee_raw == "":
        return None, None

    number = _js_number(assignee_raw)
    if not is_js_integer(number):
        return None, {"assigneeId": ["Choose a valid assignee."]}

    return int(number), None


def _comment_body_errors(value: Any) -> list[str]:
    # The 1000-character bound matches the CHECK on comments.body in
    # spec/schema.sql. A null body is preprocessed to "" — the value the
    # reference's unsubmitted form field reads back as — so an omitted comment
    # is "required", not a type failure.
    if value is None:
        value = ""

    if not _is_string(value):
        return [_type_error("string", value)]

    body = value.strip()
    if len(body) < 1:
        return ["Comment is required."]
    if len(body) > 1000:
        return ["Comment must be 1000 characters or fewer."]
    return []


def parse_with_comment_fields(
    raw: Any,
) -> tuple[WithCommentFields, None] | tuple[None, dict[str, list[str]]]:
    """The comment fields of a create-with-comment body (commentBody/commentAuthorId)."""
    body = raw if isinstance(raw, dict) else {}

    errors: dict[str, list[str]] = {}

    comment_body_errors = _comment_body_errors(body.get("commentBody"))
    if comment_body_errors:
        errors["commentBody"] = comment_body_errors

    author, author_error = _coerced_positive_int(body.get("commentAuthorId"))
    if author_error is not None:
        errors["commentAuthorId"] = [author_error]

    if errors:
        return None, errors

    return WithCommentFields(
        comment_body=body["commentBody"].strip(), comment_author_id=author
    ), None


def parse_comment_body(
    raw: Any,
) -> tuple[CommentBodyFields, None] | tuple[None, dict[str, list[str]]]:
    """The POST /api/tasks/{id}/comments body (body/authorId).

    The same rules as the with-comment half, keyed by this endpoint's own body
    field names so an error lands on the field the client actually sent.
    """
    body = raw if isinstance(raw, dict) else {}

    errors: dict[str, list[str]] = {}

    comment_body_errors = _comment_body_errors(body.get("body"))
    if comment_body_errors:
        errors["body"] = comment_body_errors

    author, author_error = _coerced_positive_int(body.get("authorId"))
    if author_error is not None:
        errors["authorId"] = [author_error]

    if errors:
        return None, errors

    return CommentBodyFields(body=body["body"].strip(), author_id=author), None
