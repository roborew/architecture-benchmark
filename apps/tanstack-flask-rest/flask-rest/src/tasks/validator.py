# src/tasks/tasks.validator.py
#
# Input validation for the tasks surface, kept pure so it can be unit tested
# without Flask: the list query params (status/projectId/assigneeId/cursor/
# limit), and the JSON bodies of every write. The controller maps an error
# case onto the JSON 400 envelope; the model never sees an invalid value.
#
# The rules and their message strings are ported verbatim from the reference
# variant's actions.ts (TaskSchema / CommentSchema), so a client that rendered
# the reference app's validation errors renders ours unchanged. A JSON body's
# absent field is normalised to null before parsing: the reference parses
# FormData, where a field the form did not submit reads back as null, and the
# type messages ("received null") are part of that contract.

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from src.lib.query_validator import QueryParamError, parse_search_term
from src.lib.validation import BodyErrors, js_number, string_field

#: The stored status values (spec/contract.md) — identical to the reference's.
TASK_STATUSES = ("todo", "in progress", "done")

#: Digits with an optional sign — the express variant's /^-?\d+$/.
_INTEGER_PATTERN = re.compile(r"-?[0-9]+", re.ASCII)


def parse_task_status(values: Sequence[str]) -> str:
    """Parses the `status` filter.

    `status` is constrained text in the schema, so the reference's query layer
    validates it against the stored values and throws `Unknown task status:
    ...`; the same message is this API's 400 envelope. Absent, empty and
    whitespace values mean "every status". A repeated param arrives as two
    values and is rejected, like `q`.
    """
    if len(values) == 0:
        return ""

    if len(values) > 1:
        raise QueryParamError("status must be a single value")

    term = values[0].strip()

    if term and term not in TASK_STATUSES:
        raise QueryParamError(f"Unknown task status: {term}")

    return term


def _single_string(values: Sequence[str], name: str) -> str | None:
    """A single-value string param; absent is fine, a repeat is a client bug."""
    if len(values) == 0:
        return None

    if len(values) > 1:
        raise QueryParamError(f"{name} must be a single value")

    return values[0]


def _integer_param(values: Sequence[str], name: str) -> int | None:
    """An integer filter param (`projectId`/`assigneeId`/`limit`)."""
    if len(values) == 0:
        return None

    if len(values) > 1:
        raise QueryParamError(f"{name} must be a single value")

    raw = values[0]

    if _INTEGER_PATTERN.fullmatch(raw) is None:
        raise QueryParamError(f"{name} must be an integer")

    return int(raw)


@dataclass(frozen=True)
class TaskListFilters:
    """The workspace list's filters, as the model consumes them."""

    search: str
    status: str
    project_id: int | None
    assignee_id: int | None
    cursor: str | None
    #: Raw limit; the model clamps it to [1, 26] as the reference does.
    limit: int | None


def parse_task_list_query(query: Mapping[str, Sequence[str]]) -> TaskListFilters:
    """Parses the workspace list's query params: `q` searches
    title/description, `status`/`projectId`/`assigneeId` filter,
    `cursor`/`limit` page.

    Validation order is fixed (q, status, projectId, assigneeId, cursor,
    limit) so a request with several bad params always reports the same one.
    """
    search = parse_search_term(query.get("q", ()))
    status = parse_task_status(query.get("status", ()))
    project_id = _integer_param(query.get("projectId", ()), "projectId")
    assignee_id = _integer_param(query.get("assigneeId", ()), "assigneeId")
    cursor = _single_string(query.get("cursor", ()), "cursor")
    limit = _integer_param(query.get("limit", ()), "limit")

    return TaskListFilters(
        search=search,
        status=status,
        project_id=project_id,
        assignee_id=assignee_id,
        # An absent cursor is the first page; an empty one decodes to nothing.
        cursor=cursor,
        limit=limit,
    )


@dataclass(frozen=True)
class ProjectTaskFilters:
    """A project board's filters: the workspace list's minus the ones a board
    cannot vary (its project is the URL; its order is created_at, so no
    search)."""

    status: str
    cursor: str | None
    limit: int | None


def parse_project_task_list_query(
    query: Mapping[str, Sequence[str]],
) -> ProjectTaskFilters:
    status = parse_task_status(query.get("status", ()))
    cursor = _single_string(query.get("cursor", ()), "cursor")
    limit = _integer_param(query.get("limit", ()), "limit")

    return ProjectTaskFilters(status=status, cursor=cursor, limit=limit)


# ---------------------------------------------------------------------------
# Write-side bodies (rules ported verbatim from the reference's actions.ts)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TaskFields:
    title: str
    description: str
    status: str


def parse_task_fields(raw: Any) -> TaskFields | BodyErrors:
    """The task fields a create or update body submits
    (title/description/status)."""
    body = raw if isinstance(raw, dict) else {}
    errors: dict[str, list[str]] = {}

    title, title_errors = string_field(body.get("title"))
    if not title_errors:
        # Matches the CHECK (char_length BETWEEN 1 AND 200) in
        # spec/schema.sql, so the same bound is enforced in the form and the
        # database.
        if len(title) < 1:
            title_errors = ["Title is required."]
        elif len(title) > 200:
            title_errors = ["Title must be 200 characters or fewer."]
    if title_errors:
        errors["title"] = title_errors

    # An omitted description is legal (the column defaults to ''), so null —
    # which is what a field the client did not send reads back as — is
    # normalised here rather than reported as a validation failure.
    raw_description = body.get("description")
    if raw_description is None:
        description, description_errors = "", []
    else:
        description, description_errors = string_field(raw_description)
    if description_errors:
        errors["description"] = description_errors

    # The enum's message overrides every issue, as the reference's
    # z.enum(values, { message }) does: a missing status and an unknown one
    # land on the same line.
    status = body.get("status")
    if status not in TASK_STATUSES:
        errors["status"] = ["Choose a valid status."]

    if errors:
        return BodyErrors(errors)

    return TaskFields(title=title, description=description, status=status)


def parse_create_task_refs(raw: Any) -> tuple[int, int | None] | BodyErrors:
    """The pure half of the reference's `resolveRefs`: which ids could name a
    row.

    `assigneeId` is nullable, and spec/contract.md gives exactly one way to
    unassign — an explicit empty choice — so absent, null and "" all mean
    "unassigned" rather than invalid. Everything else must be an integer (the
    JS Number() coercion, since a <select> submits a string); the database
    half (does the row exist) is the model's, run only once the shape is
    known to be good.
    """
    body = raw if isinstance(raw, dict) else {}
    errors: dict[str, list[str]] = {}

    project_raw = body.get("projectId")
    project_number = float("nan") if project_raw is None else js_number(project_raw)

    assignee_raw = body.get("assigneeId")
    assignee_id: int | None = None
    if assignee_raw is not None and assignee_raw != "":
        number = js_number(assignee_raw)
        if number.is_integer():
            assignee_id = int(number)
        else:
            errors["assigneeId"] = ["Choose a valid assignee."]

    if not project_number.is_integer():
        errors["projectId"] = ["Choose a project."]

    if errors:
        return BodyErrors(errors)

    return int(project_number), assignee_id


def parse_update_assignee(raw: Any) -> int | None | BodyErrors:
    """The update body's assignee: the same rule as parse_create_task_refs,
    alone."""
    body = raw if isinstance(raw, dict) else {}

    assignee_raw = body.get("assigneeId")
    if assignee_raw is None or assignee_raw == "":
        return None

    number = js_number(assignee_raw)

    if not number.is_integer():
        return BodyErrors({"assigneeId": ["Choose a valid assignee."]})

    return int(number)


def _positive_int_field(value: Any) -> tuple[int, list[str]]:
    """zod's ``z.coerce.number().int().positive()`` on one field: the coerced
    id, or the issue messages in chain order."""
    number = js_number(value)

    if number != number:  # NaN: the coercion itself failed
        return 0, ["Invalid input: expected number, received nan"]
    if not number.is_integer():
        return 0, [f"Invalid input: expected integer, received {number}"]
    if number <= 0:
        return 0, ["Too small: expected number to be >0"]

    return int(number), []


def _comment_body_field(value: Any) -> tuple[str, list[str]]:
    """The comment half of a body: preprocess null to "", then the string
    chain with the 1000-character bound that matches the CHECK on
    comments.body in spec/schema.sql."""
    if value is None:
        value = ""

    body, errors = string_field(value)

    if errors:
        return "", errors
    if len(body) < 1:
        return "", ["Comment is required."]
    if len(body) > 1000:
        return "", ["Comment must be 1000 characters or fewer."]

    return body, []


@dataclass(frozen=True)
class WithCommentFields:
    comment_body: str
    comment_author_id: int


def parse_with_comment_fields(raw: Any) -> WithCommentFields | BodyErrors:
    """The comment fields of a create-with-comment body
    (commentBody/commentAuthorId), keyed as the reference's CommentSchema keys
    it. The author is coerced because it arrives from a <select> as a string."""
    body = raw if isinstance(raw, dict) else {}
    errors: dict[str, list[str]] = {}

    comment_body, comment_errors = _comment_body_field(body.get("commentBody"))
    if comment_errors:
        errors["commentBody"] = comment_errors

    author, author_errors = _positive_int_field(body.get("commentAuthorId"))
    if author_errors:
        errors["commentAuthorId"] = author_errors

    if errors:
        return BodyErrors(errors)

    return WithCommentFields(comment_body=comment_body, comment_author_id=author)


@dataclass(frozen=True)
class CommentBodyFields:
    body: str
    author_id: int


def parse_comment_body(raw: Any) -> CommentBodyFields | BodyErrors:
    """A comment submitted on an existing task. The same rules as the
    with-comment half, keyed by this endpoint's own body field names
    (body/authorId) so an error lands on the field the client actually sent."""
    body = raw if isinstance(raw, dict) else {}
    errors: dict[str, list[str]] = {}

    comment_body, comment_errors = _comment_body_field(body.get("body"))
    if comment_errors:
        errors["body"] = comment_errors

    author, author_errors = _positive_int_field(body.get("authorId"))
    if author_errors:
        errors["authorId"] = author_errors

    if errors:
        return BodyErrors(errors)

    return CommentBodyFields(body=comment_body, author_id=author)
