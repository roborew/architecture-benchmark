# app/dashboard/schemas.py
#
# The response shapes of the dashboard surface, keyed by the camelCase aliases
# the model's SQL returns.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class _Aliased(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class DashboardStats(_Aliased):
    """Workspace totals for the stat cards."""

    project_count: Annotated[int, Field(alias="projectCount")]
    total_tasks: Annotated[int, Field(alias="totalTasks")]
    open_tasks: Annotated[int, Field(alias="openTasks")]
    people_count: Annotated[int, Field(alias="peopleCount")]
    todo_tasks: Annotated[int, Field(alias="todoTasks")]
    in_progress_tasks: Annotated[int, Field(alias="inProgressTasks")]
    done_tasks: Annotated[int, Field(alias="doneTasks")]


class DashboardTask(_Aliased):
    """The recent-tasks table's row: a task without project id, description or
    comment count."""

    id: int
    title: str
    project_name: Annotated[str, Field(alias="projectName")]
    status: str
    assignee_name: Annotated[str, Field(alias="assigneeName")]
    updated_at: Annotated[str, Field(alias="updatedAt")]


class DashboardProject(_Aliased):
    """The dashboard card's project: the listing row without the creation date."""

    id: int
    name: str
    description: str
    task_count: Annotated[int, Field(alias="taskCount")]
    open_task_count: Annotated[int, Field(alias="openTaskCount")]
    people_count: Annotated[int, Field(alias="peopleCount")]


class Dashboard(_Aliased):
    """GET /api/dashboard — the stats, recent tasks and busiest projects."""

    stats: DashboardStats
    recent_tasks: Annotated[list[DashboardTask], Field(alias="recentTasks")]
    projects: list[DashboardProject]
