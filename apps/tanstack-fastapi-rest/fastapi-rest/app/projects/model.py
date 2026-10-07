# app/projects/model.py
#
# The model layer for projects: the only place that knows the projects SQL.
# Mirrors the reference variant (apps/tanstack-start-react/src/lib/data.ts —
# getProjects, getProject, getProjectTasks; actions.ts — createProject,
# updateProject, deleteProject) statement for statement, so both apps return
# identical rows and make identical changes for the same database.
#
# The project task board (GET /api/projects/{id}/tasks) is served here because
# it is this surface's read: the task-row projection it returns is the shared
# one (app/lib/task_projection.py), so a board row cannot drift from the
# workspace list's row for the same task.

from __future__ import annotations

import logging
from typing import Protocol

from psycopg_pool import AsyncConnectionPool

from app.lib.cursor import decode_cursor, encode_cursor
from app.lib.task_projection import (
    TASK_CREATED_AT_CURSOR_FIELD,
    TASK_PROJECTION_FIELDS,
    TASK_PROJECTION_FROM,
)
from app.tasks.model import clamp_limit
from app.tasks.schemas import ProjectTaskRow
from app.tasks.validator import ProjectTaskFilters

from .schemas import Project

logger = logging.getLogger("fastapi-rest")

PROJECT_UPDATE_OK = "ok"
PROJECT_UPDATE_MISSING = "missing"
PROJECT_DELETE_OK = "ok"
PROJECT_DELETE_MISSING = "missing"
PROJECT_DELETE_RESTRICTED = "restricted"


class ProjectCreateInput:
    __slots__ = ("name", "description")

    def __init__(self, *, name: str, description: str) -> None:
        self.name = name
        self.description = description


class ProjectsModel(Protocol):
    """The projects surface's data contract, as the controller sees it."""

    async def list(self, term: str) -> list[Project]: ...

    async def get(self, id: int) -> Project | None: ...

    async def list_tasks(
        self, project_id: int, filters: ProjectTaskFilters
    ) -> list[ProjectTaskRow]: ...

    async def create(self, input: ProjectCreateInput) -> int: ...

    async def update(self, id: int, input: ProjectCreateInput) -> str: ...

    async def remove(self, id: int) -> tuple[str, str]: ...


def escape_like(term: str) -> str:
    # ILIKE treats %, _ and \ as wildcards, so a search for "100%" must not
    # match every row — the term is escaped before it reaches the pattern.
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# The project projection, with the aggregate columns the listing table
# renders. COUNT(DISTINCT t.assignee_id) is DISTINCT because a project with
# several tasks by the same member still has exactly one member.
_PROJECT_FIELDS = """
    p.id::int AS id,
    p.name,
    p.description,
    COUNT(t.id)::int AS "taskCount",
    COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
    COUNT(DISTINCT t.assignee_id)::int AS "peopleCount",
    (p.created_at AT TIME ZONE 'UTC')::date::text AS "createdAt"
"""
_PROJECT_FROM = """
    FROM projects p
    LEFT JOIN tasks t ON p.id = t.project_id
"""


class PostgresProjectsModel:
    """The projects SQL, parameterised by the app's connection pool."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def list(self, term: str) -> list[Project]:
        where = ""
        params: list[object] = []

        if term:
            pattern = f"%{escape_like(term)}%"
            where = "WHERE p.name ILIKE %s OR p.description ILIKE %s"
            params = [pattern, pattern]

        sql = f"""
            SELECT
                {_PROJECT_FIELDS}
            {_PROJECT_FROM}
            {where}
            GROUP BY p.id, p.name, p.description, p.created_at
            ORDER BY p.created_at DESC, p.id DESC
        """

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    rows = (await (await cur.execute(sql, params)).fetchall()) or []
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch projects.") from error

        return [Project.model_validate(row) for row in rows]

    async def get(self, id: int) -> Project | None:
        sql = f"""
            SELECT
                {_PROJECT_FIELDS}
            {_PROJECT_FROM}
            WHERE p.id = %s
            GROUP BY p.id, p.name, p.description, p.created_at
        """

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    row = await (await cur.execute(sql, (id,))).fetchone()
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch the project.") from error

        return Project.model_validate(row) if row is not None else None

    async def list_tasks(
        self, project_id: int, filters: ProjectTaskFilters
    ) -> list[ProjectTaskRow]:
        where: list[str] = ["t.project_id = %s"]
        params: list[object] = [project_id]

        if filters.status:
            where.append("t.status = %s")
            params.append(filters.status)

        # Keyset rather than OFFSET: OFFSET re-walks every skipped row, so
        # page 50 costs 50x page 1, and a row inserted mid-walk shifts the
        # window. Comparing the row tuple in one predicate lets Postgres use
        # tasks_project_created_id_idx directly. Bound as text and cast in
        # SQL rather than as a timestamptz so an unusable cursor matches
        # nothing instead of failing in the driver.
        decoded = decode_cursor(filters.cursor)
        if decoded is not None:
            where.append("(t.created_at, t.id) < (%s::text::timestamptz, %s)")
            params.extend([decoded.created_at, decoded.id])

        sql = f"""
            SELECT
                {TASK_PROJECTION_FIELDS},
                {TASK_CREATED_AT_CURSOR_FIELD}
            {TASK_PROJECTION_FROM}
            WHERE {" AND ".join(where)}
            GROUP BY t.id, p.name, u.display_name, t.created_at
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT %s
        """
        params.append(clamp_limit(filters.limit))

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    rows = (await (await cur.execute(sql, params)).fetchall()) or []
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch the project tasks.") from error

        return [
            ProjectTaskRow.model_validate(
                {**row, "cursorFor": encode_cursor(row["createdAtRaw"], row["id"])}
            )
            for row in rows
        ]

    async def create(self, input: ProjectCreateInput) -> int:
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    # created_at is NOT NULL with no default, so the server
                    # sets it. RETURNING id so the client can go to the row
                    # that was just created (the contract redirects a create
                    # to the new project's board).
                    row = await (
                        await cur.execute(
                            """
                        INSERT INTO projects (name, description, created_at)
                        VALUES (%s, %s, now())
                        RETURNING id::int AS id
                        """,
                            (input.name, input.description),
                        )
                    ).fetchone()
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to create the project.") from error

        return row["id"]

    async def update(self, id: int, input: ProjectCreateInput) -> str:
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    # RETURNING distinguishes "no such row" from "row updated",
                    # so a stale form cannot report success for a project
                    # that is already gone.
                    updated = await (
                        await cur.execute(
                            """
                        UPDATE projects
                        SET name = %s, description = %s
                        WHERE id = %s
                        RETURNING id
                        """,
                            (input.name, input.description, id),
                        )
                    ).fetchall()

                    if not updated:
                        return PROJECT_UPDATE_MISSING

                    return PROJECT_UPDATE_OK
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to update the project.") from error

        return PROJECT_UPDATE_MISSING

    async def remove(self, id: int) -> tuple[str, str]:
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    deleted = await (
                        await cur.execute(
                            "DELETE FROM projects WHERE id = %s RETURNING id", (id,)
                        )
                    ).fetchall()

                    if not deleted:
                        return (PROJECT_DELETE_MISSING, "")

                    return (PROJECT_DELETE_OK, "")
        except Exception as error:
            # tasks.project_id is ON DELETE RESTRICT, so a project that still
            # has tasks cannot be removed. psycopg maps the two SQLSTATEs to
            # RestrictViolation / ForeignKeyViolation; both mean the same
            # thing here. This is a rule the user can act on, so it is
            # reported rather than raised — on a fresh connection block,
            # since the failed one's transaction is aborted.
            from psycopg.errors import ForeignKeyViolation, RestrictViolation

            if isinstance(error, (RestrictViolation, ForeignKeyViolation)):
                count = await self._count_tasks(id)
                return (PROJECT_DELETE_RESTRICTED, _restriction_message(count))

            logger.exception("Database Error:")
            raise RuntimeError("Failed to delete the project.") from error

    async def _count_tasks(self, id: int) -> int:
        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                row = await (
                    await cur.execute(
                        "SELECT COUNT(*)::int AS count FROM tasks WHERE project_id = %s",
                        (id,),
                    )
                ).fetchone()

        return (row or {}).get("count", 0)


def _restriction_message(count: int) -> str:
    if count == 1:
        return "This project still has 1 task. Delete it before deleting the project."
    return f"This project still has {count} tasks. Delete them before deleting the project."


def create_projects_model(pool: AsyncConnectionPool) -> ProjectsModel:
    return PostgresProjectsModel(pool)
