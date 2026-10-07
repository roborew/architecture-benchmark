# app/tasks/schemas.py
#
# The response shapes of the tasks surface. Each model's aliases spell the
# camelCase keys the SQL projection returns (app/lib/task_projection.py), so a
# row validates straight from the database and serializes back to exactly the
# JSON the Express variant served — while FastAPI's response models give the
# OpenAPI schema and a runtime guarantee that a row never drifts from the
# documented shape.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class _Aliased(BaseModel):
    """Accepts rows keyed by their camelCase SQL aliases, emits them back."""

    model_config = ConfigDict(populate_by_name=True)


class Task(_Aliased):
    """A task joined with its project name, as the workspace list renders it."""

    id: int
    project_id: Annotated[int, Field(alias="projectId")]
    project_name: Annotated[str, Field(alias="projectName")]
    title: str
    description: str
    status: str
    assignee_name: Annotated[str, Field(alias="assigneeName")]
    comment_count: Annotated[int, Field(alias="commentCount")]
    updated_at: Annotated[str, Field(alias="updatedAt")]


class TaskRow(Task):
    """A workspace-list row: the task plus the next page's `(updated_at, id)` cursor."""

    # Raw `updated_at` at microsecond precision, the cursor's time component.
    updated_at_raw: Annotated[str, Field(alias="updatedAtRaw")]
    # The opaque `(updated_at, id)` tuple the next page starts after.
    cursor_for: Annotated[str, Field(alias="cursorFor")]


class ProjectTaskRow(Task):
    """A project-board row: the board pages over `(created_at, id)` instead."""

    created_at_raw: Annotated[str, Field(alias="createdAtRaw")]
    cursor_for: Annotated[str, Field(alias="cursorFor")]


class Comment(_Aliased):
    """A comment on a task, with its author's display name."""

    id: int
    task_id: Annotated[int, Field(alias="taskId")]
    author_name: Annotated[str, Field(alias="authorName")]
    body: str
    created_at: Annotated[str, Field(alias="createdAt")]


class CountResult(BaseModel):
    """GET /api/tasks/count — how many tasks match the list's filters."""

    count: int
