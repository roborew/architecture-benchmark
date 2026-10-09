# app/users/schemas.py
#
# The response shapes of the users surface, keyed by the camelCase aliases the
# model's SQL returns (and the member's task rows by the shared task
# projection), so a row validates straight from the database and serializes
# to exactly the JSON the Express variant served.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.tasks.schemas import Task


class _Aliased(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class User(_Aliased):
    """A workspace member with the aggregate counts the listing renders."""

    id: int
    name: str
    email: str
    assigned_task_count: Annotated[int, Field(alias="assignedTaskCount")]
    open_task_count: Annotated[int, Field(alias="openTaskCount")]
    comment_count: Annotated[int, Field(alias="commentCount")]
