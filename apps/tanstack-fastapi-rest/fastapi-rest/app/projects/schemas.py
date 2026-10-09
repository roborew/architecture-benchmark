# app/projects/schemas.py
#
# The response shapes of the projects surface, keyed by the camelCase aliases
# the model's SQL returns (and the board's task rows by the shared task
# projection), so a row validates straight from the database and serializes
# to exactly the JSON the Express variant served.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.tasks.schemas import ProjectTaskRow


class Project(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    name: str
    description: str
    task_count: Annotated[int, Field(alias="taskCount")]
    open_task_count: Annotated[int, Field(alias="openTaskCount")]
    people_count: Annotated[int, Field(alias="peopleCount")]
    created_at: Annotated[str, Field(alias="createdAt")]
