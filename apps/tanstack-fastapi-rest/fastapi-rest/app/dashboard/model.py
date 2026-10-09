# app/dashboard/model.py
#
# The model layer for the dashboard: the only place that knows the dashboard
# SQL. Mirrors the reference variant (apps/tanstack-start-react/src/lib/
# data.ts — getDashboardStats, getRecentTasks, getDashboardProjects)
# statement for statement, so both apps return identical rows for the same
# database.
#
# The dashboard's task rows use their own slimmer projection rather than the
# shared task projection (app/lib/task_projection.py): the recent-tasks table
# shows no description, project id or comment count, and pulling columns the
# card never renders would cost the join for nothing.

from __future__ import annotations

import logging
from typing import Protocol

from psycopg_pool import AsyncConnectionPool

from .schemas import DashboardProject, DashboardStats, DashboardTask

logger = logging.getLogger("fastapi-rest")

# How many rows each dashboard section shows.
DASHBOARD_RECENT_TASKS = 3
DASHBOARD_PROJECTS = 2


class DashboardModel(Protocol):
    """The dashboard surface's data contract, as the controller sees it."""

    async def stats(self) -> DashboardStats: ...

    async def recent_tasks(self) -> list[DashboardTask]: ...

    async def projects(self) -> list[DashboardProject]: ...


class PostgresDashboardModel:
    """The dashboard SQL, parameterised by the app's connection pool."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def stats(self) -> DashboardStats:
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    # One statement rather than three, because the cards are
                    # rendered together and separate COUNT queries would each
                    # scan a different table for the same row.
                    row = await (
                        await cur.execute("""
                        SELECT
                          (SELECT COUNT(*) FROM projects)::int AS "projectCount",
                          (SELECT COUNT(*) FROM tasks)::int AS "totalTasks",
                          (SELECT COUNT(*) FROM tasks WHERE status <> 'done')::int AS "openTasks",
                          (SELECT COUNT(*) FROM users)::int AS "peopleCount",
                          (SELECT COUNT(*) FROM tasks WHERE status = 'todo')::int AS "todoTasks",
                          (SELECT COUNT(*) FROM tasks WHERE status = 'in progress')::int AS "inProgressTasks",
                          (SELECT COUNT(*) FROM tasks WHERE status = 'done')::int AS "doneTasks"
                    """)
                    ).fetchone()
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch the dashboard stats.") from error

        return DashboardStats.model_validate(row)

    async def recent_tasks(self) -> list[DashboardTask]:
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    rows = (
                        await (
                            await cur.execute(
                                """
                        SELECT
                          t.id::int AS id,
                          t.title,
                          p.name AS "projectName",
                          t.status,
                          COALESCE(u.display_name, 'Unassigned') AS "assigneeName",
                          to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
                        FROM tasks t
                        JOIN projects p ON p.id = t.project_id
                        LEFT JOIN users u ON u.id = t.assignee_id
                        ORDER BY t.updated_at DESC, t.id DESC
                        LIMIT %s
                        """,
                                (DASHBOARD_RECENT_TASKS,),
                            )
                        ).fetchall()
                    ) or []
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch recent tasks.") from error

        # Ordered by `updated_at` rather than `created_at`: "recent activity"
        # means when the work last moved, which is also what the task update
        # advances.
        return [DashboardTask.model_validate(row) for row in rows]

    async def projects(self) -> list[DashboardProject]:
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    rows = (
                        await (
                            await cur.execute(
                                """
                        SELECT
                          p.id::int AS id,
                          p.name,
                          p.description,
                          COUNT(t.id)::int AS "taskCount",
                          COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
                          COUNT(DISTINCT t.assignee_id)::int AS "peopleCount"
                        FROM projects p
                        LEFT JOIN tasks t ON p.id = t.project_id
                        GROUP BY p.id, p.name, p.description
                        ORDER BY COUNT(t.id) DESC, p.id ASC
                        LIMIT %s
                        """,
                                (DASHBOARD_PROJECTS,),
                            )
                        ).fetchall()
                    ) or []
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch dashboard projects.") from error

        # Ordered by task count so the cards answer "where is the work?"
        # rather than repeating the newest-first ordering of every other list.
        return [DashboardProject.model_validate(row) for row in rows]


def create_dashboard_model(pool: AsyncConnectionPool) -> DashboardModel:
    return PostgresDashboardModel(pool)
