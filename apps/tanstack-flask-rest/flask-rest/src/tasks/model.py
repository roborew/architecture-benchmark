# src/tasks/tasks.model.py
#
# The model layer for tasks: the only place that knows the tasks SQL. Mirrors
# the reference variant's reads (apps/tanstack-start-react/src/lib/data.ts —
# getTasks, getTask, getComments, countTasks, getUserTasks) and writes
# (actions.ts — createTask, updateTask, deleteTask, createTaskWithComment,
# createComment, resolveRefs) statement for statement, so both apps return
# identical rows and make identical changes for the same database.
#
# The task row is the shared projection every surface that renders a task uses
# (src/lib/task_projection.py): the project name from its join, the assignee
# name COALESCEed for unassigned tasks, and the comment count aggregated here
# so a listing needs no second query. A task's stored status reaches the client
# untranslated — the stored values are the contract.
#
# Comments live in this domain: they are a sub-resource of a task
# (comments.task_id), and every comment read/write here is scoped by one.

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
    TASK_UPDATED_AT_CURSOR_FIELD,
)
from src.tasks.validator import ProjectTaskFilters, TaskListFilters

logger = logging.getLogger(__name__)

#: spec/queries.md — a task list page carries at most 25 rows.
PAGE_SIZE = 25

#: spec/queries.md — a task detail shows the 10 most recent comments.
COMMENTS_PER_TASK = 10


class Task(TypedDict):
    """A task joined with its project name, as the workspace list renders it."""

    id: int
    projectId: int
    projectName: str
    title: str
    description: str
    status: str
    assigneeName: str
    commentCount: int
    updatedAt: str


class TaskRow(TypedDict):
    """A workspace-list row: the task plus the raw (updated_at, id) cursor
    parts and the packed cursor the next page starts after."""

    updatedAtRaw: str
    cursorFor: str


class ProjectTaskRow(TypedDict):
    """A project-board row: the board pages over (created_at, id) instead."""

    createdAtRaw: str
    cursorFor: str


class Comment(TypedDict):
    id: int
    taskId: int
    authorName: str
    body: str
    createdAt: str


@dataclass(frozen=True)
class TaskCreateInput:
    project_id: int
    assignee_id: int | None
    title: str
    description: str
    status: str


@dataclass(frozen=True)
class TaskUpdateInput:
    title: str
    description: str
    status: str
    assignee_id: int | None


@dataclass(frozen=True)
class WithCommentInput:
    task: TaskCreateInput
    comment_body: str
    comment_author_id: int


TaskUpdateResult = Literal["ok", "missing", "assignee-missing"]
AddCommentResult = Literal["ok", "task-missing", "author-missing"]
#: create_with_comment: the new task's id, or the author-missing marker.
CreateWithCommentResult = int | Literal["author-missing"]


class TasksModel(Protocol):
    """The tasks surface, as the controller sees it: SQL in, plain rows out."""

    def list(self, filters: TaskListFilters) -> list[TaskRow]:
        """The workspace-wide task list, ordered by ``updated_at DESC, id
        DESC``, one keyset page of at most `limit` rows (clamped to
        [1, 26], default 25)."""
        ...

    def get(self, id: int) -> Task | None:
        """One task by id with its project and assignee names, or None."""
        ...

    def list_by_project(
        self, project_id: int, filters: ProjectTaskFilters
    ) -> list[ProjectTaskRow]:
        """One page of a project's tasks, newest first: ordered
        ``created_at DESC, id DESC``, keyset-paged, at most `limit` rows
        (clamped to [1, 26], default 25)."""
        ...

    def list_by_assignee(self, assignee_id: int) -> list[Task]:
        """The tasks assigned to one member, ordered ``updated_at DESC, id
        DESC``. Scoped by assignee_id rather than a name: two members can
        share a display name, and a name filter would hand each of them the
        other's work."""
        ...

    def list_comments(self, task_id: int) -> list[Comment]:
        """The 10 most recent comments on one task, newest first."""
        ...

    def count(self, filters: TaskListFilters) -> int:
        """Counts the tasks matching the workspace list's filters. A second
        statement rather than a window function, deliberately: the list is
        LIMITed, and ``COUNT(*) OVER ()`` would force Postgres to materialise
        every matching row before discarding all but the first page."""
        ...

    def resolve_refs(
        self, project_id: int, assignee_id: int | None
    ) -> dict[str, list[str]]:
        """The database half of the reference's resolveRefs: whether the ids
        that passed shape validation name real rows. Returns field errors so
        an unknown id lands on its field like any other validation failure."""
        ...

    def create(self, input: TaskCreateInput) -> int:
        """Inserts one task (created_at/updated_at set equal) and returns its
        id."""
        ...

    def update(self, id: int, input: TaskUpdateInput) -> TaskUpdateResult:
        """Updates one task by primary key, explicitly advancing updated_at."""
        ...

    def remove(self, id: int) -> int | None:
        """Deletes one task under the documented cascade and reports the
        project the contract redirects the client to. None when no such row
        exists."""
        ...

    def create_with_comment(self, input: WithCommentInput) -> CreateWithCommentResult:
        """spec/queries.md — "Create with initial comment": ONE transaction
        inserting the task then its comment, any failure rolling back both.
        Checks the comment author first so an unknown id is a field error
        rather than a thrown FK violation."""
        ...

    def add_comment(self, task_id: int, body: str, author_id: int) -> AddCommentResult:
        """Adds one comment to an existing task."""
        ...


def _clamped_limit(limit: int | None) -> int:
    """Clamped so a caller cannot ask for an unbounded page. One row above
    the page size is allowed deliberately: fetching PAGE + 1 and dropping the
    last is how the caller learns whether an older page exists without a
    COUNT."""
    raw = PAGE_SIZE if limit is None else limit
    return max(1, min(raw, PAGE_SIZE + 1))


def _search_filter(term: str) -> Composable:
    # LIKE wildcards in a search box are almost always a literal character
    # the user typed, not a pattern. Without escaping, a single % matches
    # every row and hides a real filtering bug.
    return (
        SQL(" AND (t.title ILIKE %(term)s OR t.description ILIKE %(term)s)")
        if term
        else SQL("")
    )


def _cursor_filter(decoded, column: str) -> Composable:
    """The keyset predicate: ``(column, id) < (cursor, id)``.

    Keyset rather than OFFSET: OFFSET re-walks every skipped row, so page 50
    costs 50x page 1, and a row inserted mid-walk shifts the window. The
    cursor is bound as text and cast in SQL rather than as a timestamptz:
    binding a datetime would make a stale or hand-edited cursor fail in the
    driver instead of simply not matching a row.
    """
    if decoded is None:
        return SQL("")

    field = SQL("t.updated_at") if column == "updated_at" else SQL("t.created_at")
    return SQL(
        " AND ({}, t.id) < (%(cursor_at)s::text::timestamptz, %(cursor_id)s)"
    ).format(field)


# The insert shared by create() and create_with_comment(): spec/queries.md —
# the server sets created_at and updated_at explicitly and equal (now() is
# the transaction timestamp, so both calls in one statement return the same
# instant). RETURNING id so the client can go to the row that was just
# created.
_TASK_INSERT = SQL(
    """
    INSERT INTO tasks (
      project_id, assignee_id, title, description, status, created_at, updated_at
    )
    VALUES (
      %(project_id)s, %(assignee_id)s, %(title)s, %(description)s, %(status)s, now(), now()
    )
    RETURNING id::int AS id
    """
)


class PostgresTasksModel:
    """The tasks SQL against the composed ``Db``."""

    def __init__(self, db: Db) -> None:
        self._db = db

    def list(self, filters: TaskListFilters) -> list[TaskRow]:
        term = filters.search.strip()
        decoded = decode_cursor(filters.cursor)

        parts: list[Composable] = [
            SQL("SELECT"),
            TASK_PROJECTION_FIELDS,
            SQL(","),
            TASK_UPDATED_AT_CURSOR_FIELD,
            TASK_PROJECTION_FROM,
            SQL(" WHERE 1 = 1"),
            SQL("")
            if filters.project_id is None
            else SQL(" AND t.project_id = %(project_id)s"),
            SQL("") if not filters.status else SQL(" AND t.status = %(status)s"),
            SQL("")
            if filters.assignee_id is None
            else SQL(" AND t.assignee_id = %(assignee_id)s"),
            _search_filter(term),
            _cursor_filter(decoded, "updated_at"),
            SQL(
                " GROUP BY t.id, p.name, u.display_name, t.updated_at"
                " ORDER BY t.updated_at DESC, t.id DESC"
                " LIMIT %(limit)s"
            ),
        ]

        params: dict[str, object] = {"limit": _clamped_limit(filters.limit)}
        if filters.project_id is not None:
            params["project_id"] = filters.project_id
        if filters.status:
            params["status"] = filters.status
        if filters.assignee_id is not None:
            params["assignee_id"] = filters.assignee_id
        if term:
            params["term"] = f"%{escape_like(term)}%"
        if decoded is not None:
            params["cursor_at"] = decoded.created_at
            params["cursor_id"] = decoded.id

        try:
            rows = self._db.query(Composed(parts), params)
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch tasks.") from error

        # Derived here rather than in SQL so cursor packing has one
        # implementation, shared with the decoder this query reads a page back
        # with.
        for row in rows:
            row["cursorFor"] = encode_cursor(row["updatedAtRaw"], row["id"])

        return rows

    def get(self, id: int) -> Task | None:
        try:
            rows = self._db.query(
                Composed(
                    [
                        SQL("SELECT"),
                        TASK_PROJECTION_FIELDS,
                        TASK_PROJECTION_FROM,
                        SQL(
                            " WHERE t.id = %(id)s GROUP BY t.id, p.name, u.display_name"
                        ),
                    ]
                ),
                {"id": id},
            )
            return rows[0] if rows else None
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch the task.") from error

    def list_by_project(
        self, project_id: int, filters: ProjectTaskFilters
    ) -> list[ProjectTaskRow]:
        # The board pages over (created_at, id): the board is "newest first"
        # by when work appeared, not by when it last moved. Comparing the row
        # tuple in one predicate lets Postgres use tasks_project_created_id_idx
        # directly.
        decoded = decode_cursor(filters.cursor)

        parts: list[Composable] = [
            SQL("SELECT"),
            TASK_PROJECTION_FIELDS,
            SQL(","),
            TASK_CREATED_AT_CURSOR_FIELD,
            TASK_PROJECTION_FROM,
            SQL(" WHERE t.project_id = %(project_id)s"),
            SQL("") if not filters.status else SQL(" AND t.status = %(status)s"),
            _cursor_filter(decoded, "created_at"),
            SQL(
                " GROUP BY t.id, p.name, u.display_name, t.created_at"
                " ORDER BY t.created_at DESC, t.id DESC"
                " LIMIT %(limit)s"
            ),
        ]

        params: dict[str, object] = {
            "project_id": project_id,
            "limit": _clamped_limit(filters.limit),
        }
        if filters.status:
            params["status"] = filters.status
        if decoded is not None:
            params["cursor_at"] = decoded.created_at
            params["cursor_id"] = decoded.id

        try:
            rows = self._db.query(Composed(parts), params)
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch the project tasks.") from error

        for row in rows:
            row["cursorFor"] = encode_cursor(row["createdAtRaw"], row["id"])

        return rows

    def list_by_assignee(self, assignee_id: int) -> list[Task]:
        try:
            return self._db.query(
                Composed(
                    [
                        SQL("SELECT"),
                        TASK_PROJECTION_FIELDS,
                        TASK_PROJECTION_FROM,
                        SQL(
                            " WHERE t.assignee_id = %(assignee_id)s"
                            " GROUP BY t.id, p.name, u.display_name"
                            " ORDER BY t.updated_at DESC, t.id DESC"
                        ),
                    ]
                ),
                {"assignee_id": assignee_id},
            )
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch the user's tasks.") from error

    def list_comments(self, task_id: int) -> list[Comment]:
        try:
            return self._db.query(
                SQL(
                    """
                    SELECT
                      c.id::int AS id,
                      c.task_id::int AS "taskId",
                      u.display_name AS "authorName",
                      c.body,
                      to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
                    FROM comments c
                    JOIN users u ON u.id = c.author_id
                    WHERE c.task_id = %(task_id)s
                    ORDER BY c.created_at DESC, c.id DESC
                    LIMIT %(limit)s
                    """
                ),
                {"task_id": task_id, "limit": COMMENTS_PER_TASK},
            )
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch the task comments.") from error

    def count(self, filters: TaskListFilters) -> int:
        term = filters.search.strip()

        parts: list[Composable] = [
            SQL("SELECT COUNT(*)::int AS count FROM tasks t WHERE 1 = 1"),
            SQL("")
            if filters.project_id is None
            else SQL(" AND t.project_id = %(project_id)s"),
            SQL("") if not filters.status else SQL(" AND t.status = %(status)s"),
            SQL("")
            if filters.assignee_id is None
            else SQL(" AND t.assignee_id = %(assignee_id)s"),
            _search_filter(term),
        ]

        params: dict[str, object] = {}
        if filters.project_id is not None:
            params["project_id"] = filters.project_id
        if filters.status:
            params["status"] = filters.status
        if filters.assignee_id is not None:
            params["assignee_id"] = filters.assignee_id
        if term:
            params["term"] = f"%{escape_like(term)}%"

        try:
            rows = self._db.query(Composed(parts), params)
            return rows[0]["count"] if rows else 0
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to count tasks.") from error

    def resolve_refs(
        self, project_id: int, assignee_id: int | None
    ) -> dict[str, list[str]]:
        errors: dict[str, list[str]] = {}

        project = self._db.query(
            SQL("SELECT id::int AS id FROM projects WHERE id = %(id)s"),
            {"id": project_id},
        )

        if not project:
            errors["projectId"] = ["That project no longer exists."]

        if assignee_id is not None:
            assignee = self._db.query(
                SQL("SELECT id::int AS id FROM users WHERE id = %(id)s"),
                {"id": assignee_id},
            )

            if not assignee:
                errors["assigneeId"] = ["That assignee no longer exists."]

        return errors

    def create(self, input: TaskCreateInput) -> int:
        try:
            rows = self._db.query(_TASK_INSERT, vars(input))
            return rows[0]["id"]
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to create the task.") from error

    def update(self, id: int, input: TaskUpdateInput) -> TaskUpdateResult:
        # The assignee is checked first, mirroring the reference: a bad
        # assignee is a field error (the client can fix it), a missing task is
        # a 404, and the field error is the more actionable of the two to
        # report first.
        if input.assignee_id is not None:
            assignee = self._db.query(
                SQL("SELECT id::int AS id FROM users WHERE id = %(id)s"),
                {"id": input.assignee_id},
            )

            if not assignee:
                return "assignee-missing"

        # Read the row first so a missing task is reported before anything is
        # written, exactly as the reference does.
        existing = self._db.query(
            SQL("SELECT id::int AS id FROM tasks WHERE id = %(id)s"),
            {"id": id},
        )

        if not existing:
            return "missing"

        try:
            # spec/queries.md — updated_at is set in the statement, not by a DB
            # default or an ORM side effect. RETURNING distinguishes "no such
            # row" from "row updated" if the row is deleted between the read
            # above and this write.
            rows = self._db.query(
                SQL(
                    """
                    UPDATE tasks
                    SET
                      title = %(title)s,
                      description = %(description)s,
                      status = %(status)s,
                      assignee_id = %(assignee_id)s,
                      updated_at = now()
                    WHERE id = %(id)s
                    RETURNING id
                    """
                ),
                {"id": id, **vars(input)},
            )

            if not rows:
                return "missing"

            return "ok"
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to update the task.") from error

    def remove(self, id: int) -> int | None:
        # Read the project first, because the contract redirects to its board
        # after a delete; a missing task is reported before anything is
        # written.
        existing = self._db.query(
            SQL('SELECT project_id::int AS "projectId" FROM tasks WHERE id = %(id)s'),
            {"id": id},
        )

        if not existing:
            return None

        try:
            rows = self._db.query(
                SQL("DELETE FROM tasks WHERE id = %(id)s RETURNING id"),
                {"id": id},
            )

            if not rows:
                return None

            return existing[0]["projectId"]
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to delete the task.") from error

    def create_with_comment(self, input: WithCommentInput) -> CreateWithCommentResult:
        # The author is a FK like the assignee, so an id that matches no row
        # fails the insert. Checking first turns that into a field error rather
        # than a thrown Postgres error the user cannot act on.
        author = self._db.query(
            SQL("SELECT id::int AS id FROM users WHERE id = %(id)s"),
            {"id": input.comment_author_id},
        )

        if not author:
            return "author-missing"

        try:
            # The task insert and the comment insert share one transaction: a
            # failure in either rolls back both, which is what spec/queries.md
            # means by "no partial state is ever observable".
            with self._db.transaction() as tx:
                rows = tx.query(_TASK_INSERT, vars(input.task))
                task_id = rows[0]["id"]

                # Inside the same transaction, so a failure here throws and
                # the task insert above is rolled back with it.
                tx.query(
                    SQL(
                        "INSERT INTO comments (task_id, author_id, body, created_at)"
                        " VALUES (%(task_id)s, %(author_id)s, %(body)s, now())"
                    ),
                    {
                        "task_id": task_id,
                        "author_id": input.comment_author_id,
                        "body": input.comment_body,
                    },
                )

                return task_id
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to create the task.") from error

    def add_comment(self, task_id: int, body: str, author_id: int) -> AddCommentResult:
        # The task and the author are both foreign keys. Checking first turns
        # an unknown id into an outcome the client can act on, rather than a
        # thrown Postgres error.
        task = self._db.query(
            SQL("SELECT id::int AS id FROM tasks WHERE id = %(id)s"),
            {"id": task_id},
        )
        author = self._db.query(
            SQL("SELECT id::int AS id FROM users WHERE id = %(id)s"),
            {"id": author_id},
        )

        if not task:
            return "task-missing"

        if not author:
            return "author-missing"

        try:
            self._db.query(
                SQL(
                    "INSERT INTO comments (task_id, author_id, body, created_at)"
                    " VALUES (%(task_id)s, %(author_id)s, %(body)s, now())"
                ),
                {"task_id": task_id, "author_id": author_id, "body": body},
            )

            return "ok"
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to add the comment.") from error
