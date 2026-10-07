# src/projects/projects.model.py
#
# The model layer for projects: the only place that knows the projects SQL.
# Mirrors the reference variant (apps/tanstack-start-react/src/lib/data.ts —
# getProjects, getProject, getProjectTasks; actions.ts — createProject,
# updateProject, deleteProject) statement for statement, so both apps return
# identical rows and make identical changes for the same database.
#
# The project task board (GET /api/projects/:id/tasks) is served here because
# it is this surface's read: the task-row projection it returns is the shared
# one (src/lib/task_projection.py), so a board row cannot drift from the
# workspace list's row for the same task.

import logging
from dataclasses import dataclass
from typing import Literal, Protocol, TypedDict

import psycopg2
from psycopg2.sql import SQL, Composable, Composed

from src.db.connection import Db, escape_like
from src.lib.cursor import decode_cursor, encode_cursor
from src.lib.task_projection import (
    TASK_CREATED_AT_CURSOR_FIELD,
    TASK_PROJECTION_FIELDS,
    TASK_PROJECTION_FROM,
)
from src.tasks.model import PAGE_SIZE, ProjectTaskRow
from src.tasks.validator import ProjectTaskFilters

logger = logging.getLogger(__name__)


class Project(TypedDict):
    id: int
    name: str
    description: str
    taskCount: int
    openTaskCount: int
    peopleCount: int
    createdAt: str


@dataclass(frozen=True)
class ProjectCreateInput:
    name: str
    description: str


@dataclass(frozen=True)
class DeleteRestricted:
    """A delete the schema's FK guard refused; ``message`` is the reference's
    guard text, answered as a 409."""

    message: str


ProjectUpdateResult = Literal["ok", "missing"]
ProjectDeleteResult = Literal["ok", "missing"] | DeleteRestricted


class ProjectsModel(Protocol):
    """The projects surface, as the controller sees it: SQL in, plain rows
    out."""

    def list(self, term: str) -> list[Project]:
        """Every project with its aggregate counts, ordered
        ``created_at DESC, id DESC``. An empty term returns every project."""
        ...

    def get(self, id: int) -> Project | None:
        """One project by id, with the same shape ``list`` returns, or None."""
        ...

    def list_tasks(
        self, project_id: int, filters: ProjectTaskFilters
    ) -> list[ProjectTaskRow]:
        """One page of a project's task board, newest first
        (``created_at DESC, id DESC``), keyset-paged over ``(created_at, id)``,
        at most `limit` rows (clamped to [1, 26], default 25)."""
        ...

    def create(self, input: ProjectCreateInput) -> int:
        """Inserts one project (created_at set by the server), returns its
        id."""
        ...

    def update(self, id: int, input: ProjectCreateInput) -> ProjectUpdateResult:
        """Updates one project by primary key; ``missing`` when no such row."""
        ...

    def remove(self, id: int) -> ProjectDeleteResult:
        """Deletes one project. ``DeleteRestricted`` carries the reference's
        guard message: tasks.project_id is ON DELETE RESTRICT, so a project
        that still has tasks cannot be removed."""
        ...


# The project projection, with the aggregate columns the listing table
# renders. COUNT(DISTINCT t.assignee_id) is DISTINCT because a project with
# several tasks by the same member still has exactly one member.
_PROJECT_FIELDS = SQL(
    """
    p.id::int AS id,
    p.name,
    p.description,
    COUNT(t.id)::int AS "taskCount",
    COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
    COUNT(DISTINCT t.assignee_id)::int AS "peopleCount",
    (p.created_at AT TIME ZONE 'UTC')::date::text AS "createdAt"
    """
)
_PROJECT_FROM = SQL(
    """
    FROM projects p
    LEFT JOIN tasks t ON p.id = t.project_id
    """
)


def _project_list_statement(term: str) -> Composable:
    # ILIKE treats %, _ and \ as wildcards, so a search for "100%" must not
    # match every row — the term is escaped before it reaches the pattern.
    where = (
        SQL(" WHERE p.name ILIKE %(term)s OR p.description ILIKE %(term)s")
        if term
        else SQL("")
    )

    return Composed(
        [
            SQL("SELECT"),
            _PROJECT_FIELDS,
            _PROJECT_FROM,
            where,
            SQL(
                " GROUP BY p.id, p.name, p.description, p.created_at"
                " ORDER BY p.created_at DESC, p.id DESC"
            ),
        ]
    )


class PostgresProjectsModel:
    """The projects SQL against the composed ``Db``."""

    def __init__(self, db: Db) -> None:
        self._db = db

    def list(self, term: str) -> list[Project]:
        params = {"term": f"%{escape_like(term)}%"} if term else {}
        try:
            return self._db.query(_project_list_statement(term), params)
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch projects.") from error

    def get(self, id: int) -> Project | None:
        try:
            rows = self._db.query(
                Composed(
                    [
                        SQL("SELECT"),
                        _PROJECT_FIELDS,
                        _PROJECT_FROM,
                        SQL(
                            " WHERE p.id = %(id)s"
                            " GROUP BY p.id, p.name, p.description, p.created_at"
                        ),
                    ]
                ),
                {"id": id},
            )
            return rows[0] if rows else None
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch the project.") from error

    def list_tasks(
        self, project_id: int, filters: ProjectTaskFilters
    ) -> list[ProjectTaskRow]:
        status_filter = SQL(" AND t.status = %(status)s") if filters.status else SQL("")
        decoded = decode_cursor(filters.cursor)

        # Keyset rather than OFFSET: OFFSET re-walks every skipped row, so page
        # 50 costs 50x page 1, and a row inserted mid-walk shifts the window.
        # Comparing the row tuple in one predicate lets Postgres use
        # tasks_project_created_id_idx directly. Bound as text and cast in SQL
        # rather than as a timestamptz so an unusable cursor matches nothing
        # instead of failing in the driver.
        cursor_filter = (
            SQL(
                " AND (t.created_at, t.id) < (%(cursor_at)s::text::timestamptz, %(cursor_id)s)"
            )
            if decoded is not None
            else SQL("")
        )

        # Clamped so a caller cannot ask for an unbounded page. One row above
        # the page size is allowed deliberately: fetching PAGE + 1 and dropping
        # the last is how the caller learns whether an older page exists
        # without a COUNT.
        limit = PAGE_SIZE if filters.limit is None else filters.limit
        bound = max(1, min(limit, PAGE_SIZE + 1))

        params: dict[str, object] = {"project_id": project_id, "limit": bound}
        if filters.status:
            params["status"] = filters.status
        if decoded is not None:
            params["cursor_at"] = decoded.created_at
            params["cursor_id"] = decoded.id

        try:
            rows = self._db.query(
                Composed(
                    [
                        SQL("SELECT"),
                        TASK_PROJECTION_FIELDS,
                        SQL(","),
                        TASK_CREATED_AT_CURSOR_FIELD,
                        TASK_PROJECTION_FROM,
                        SQL(" WHERE t.project_id = %(project_id)s"),
                        status_filter,
                        cursor_filter,
                        SQL(
                            " GROUP BY t.id, p.name, u.display_name, t.created_at"
                            " ORDER BY t.created_at DESC, t.id DESC"
                            " LIMIT %(limit)s"
                        ),
                    ]
                ),
                params,
            )
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch the project tasks.") from error

        for row in rows:
            row["cursorFor"] = encode_cursor(row["createdAtRaw"], row["id"])

        return rows

    def create(self, input: ProjectCreateInput) -> int:
        try:
            # created_at is NOT NULL with no default, so the server sets it.
            # RETURNING id so the client can go to the row that was just
            # created (the contract redirects a create to the new project's
            # board).
            rows = self._db.query(
                SQL(
                    "INSERT INTO projects (name, description, created_at)"
                    " VALUES (%(name)s, %(description)s, now())"
                    " RETURNING id::int AS id"
                ),
                vars(input),
            )
            return rows[0]["id"]
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to create the project.") from error

    def update(self, id: int, input: ProjectCreateInput) -> ProjectUpdateResult:
        try:
            # RETURNING distinguishes "no such row" from "row updated", so a
            # stale form cannot report success for a project that is already
            # gone.
            rows = self._db.query(
                SQL(
                    "UPDATE projects SET name = %(name)s, description = %(description)s"
                    " WHERE id = %(id)s"
                    " RETURNING id"
                ),
                {"id": id, **vars(input)},
            )

            if not rows:
                return "missing"

            return "ok"
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to update the project.") from error

    def remove(self, id: int) -> ProjectDeleteResult:
        try:
            rows = self._db.query(
                SQL("DELETE FROM projects WHERE id = %(id)s RETURNING id"),
                {"id": id},
            )

            if not rows:
                return "missing"

            return "ok"
        except psycopg2.Error as error:
            # tasks.project_id is ON DELETE RESTRICT, so a project that still
            # has tasks cannot be removed. 23001 is restrict_violation; 23503
            # is what NO ACTION raises, and both mean the same thing here.
            # This is a rule the user can act on, so it is reported rather
            # than thrown.
            if error.pgcode in ("23001", "23503"):
                count_rows = self._db.query(
                    SQL(
                        "SELECT COUNT(*)::int AS count FROM tasks WHERE project_id = %(id)s"
                    ),
                    {"id": id},
                )
                count = count_rows[0]["count"] if count_rows else 0

                if count == 1:
                    message = (
                        "This project still has 1 task. "
                        "Delete it before deleting the project."
                    )
                else:
                    message = (
                        f"This project still has {count} tasks. "
                        "Delete them before deleting the project."
                    )

                return DeleteRestricted(message=message)

            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to delete the project.") from error
