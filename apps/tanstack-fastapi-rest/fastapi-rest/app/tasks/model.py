# app/tasks/model.py
#
# The model layer for tasks: the only place that knows the tasks SQL. Mirrors
# the reference variant's reads (apps/tanstack-start-react/src/lib/data.ts —
# getTasks, getTask, getComments, countTasks, getUserTasks) and writes
# (actions.ts — createTask, updateTask, deleteTask, createTaskWithComment,
# createComment, resolveRefs) statement for statement, so both apps return
# identical rows and make identical changes for the same database.
#
# The task row is the shared projection every surface that renders a task uses
# (app/lib/task_projection.py): the project name from its join, the assignee
# name COALESCEed for unassigned tasks, and the comment count aggregated here
# so a listing needs no second query. A task's stored status reaches the client
# untranslated — the stored values are the contract.
#
# Comments live in this domain: they are a sub-resource of a task
# (comments.task_id), and every comment read/write here is scoped by one.
#
# Every method runs inside one `pool.connection()` block, which psycopg wraps
# in a single transaction: a failure rolls back everything the method wrote.

from __future__ import annotations

import logging
from typing import Any, Protocol

from psycopg_pool import AsyncConnectionPool

from app.lib.cursor import decode_cursor, encode_cursor
from app.lib.task_projection import (
    TASK_CREATED_AT_CURSOR_FIELD,
    TASK_PROJECTION_FIELDS,
    TASK_PROJECTION_FROM,
    TASK_UPDATED_AT_CURSOR_FIELD,
)

from .schemas import Comment, ProjectTaskRow, Task, TaskRow
from .validator import ProjectTaskFilters, TaskListFilters

logger = logging.getLogger("fastapi-rest")

# spec/queries.md — a task list page carries at most 25 rows.
PAGE_SIZE = 25

# spec/queries.md — a task detail shows the 10 most recent comments.
COMMENTS_PER_TASK = 10


class TaskRefErrors(dict[str, list[str]]):
    """Field errors the reference's resolveRefs produces, keyed by body field."""


class TaskCreateInput:
    __slots__ = ("project_id", "assignee_id", "title", "description", "status")

    def __init__(
        self,
        *,
        project_id: int,
        assignee_id: int | None,
        title: str,
        description: str,
        status: str,
    ) -> None:
        self.project_id = project_id
        self.assignee_id = assignee_id
        self.title = title
        self.description = description
        self.status = status


class TaskUpdateInput:
    """The update form's fields (spec/contract.md): a task's project is not
    updatable, so this shape carries no project id at all."""

    __slots__ = ("title", "description", "status", "assignee_id")

    def __init__(
        self,
        *,
        title: str,
        description: str,
        status: str,
        assignee_id: int | None,
    ) -> None:
        self.title = title
        self.description = description
        self.status = status
        self.assignee_id = assignee_id


class WithCommentInput(TaskCreateInput):
    __slots__ = ("comment_body", "comment_author_id")

    def __init__(
        self, *, comment_body: str, comment_author_id: int, **task: Any
    ) -> None:
        super().__init__(**task)
        self.comment_body = comment_body
        self.comment_author_id = comment_author_id


# The outcome values the controller maps onto its envelopes.
TASK_UPDATE_OK = "ok"
TASK_UPDATE_MISSING = "missing"
TASK_UPDATE_ASSIGNEE_MISSING = "assignee-missing"
ADD_COMMENT_OK = "ok"
ADD_COMMENT_TASK_MISSING = "task-missing"
ADD_COMMENT_AUTHOR_MISSING = "author-missing"


class TasksModel(Protocol):
    """The task surface's data contract, as the controller sees it."""

    async def list(self, filters: TaskListFilters) -> list[TaskRow]: ...

    async def get(self, id: int) -> Task | None: ...

    async def list_by_project(
        self, project_id: int, filters: ProjectTaskFilters
    ) -> list[ProjectTaskRow]: ...

    async def list_by_assignee(self, assignee_id: int) -> list[Task]: ...

    async def list_comments(self, task_id: int) -> list[Comment]: ...

    async def count(self, filters: TaskListFilters) -> int: ...

    async def resolve_refs(
        self, project_id: int, assignee_id: int | None
    ) -> TaskRefErrors: ...

    async def create(self, input: TaskCreateInput) -> int: ...

    async def update(self, id: int, input: TaskUpdateInput) -> str: ...

    async def remove(self, id: int) -> int | None: ...

    async def create_with_comment(self, input: WithCommentInput) -> tuple[str, int]: ...

    async def add_comment(self, task_id: int, body: str, author_id: int) -> str: ...


def escape_like(term: str) -> str:
    # ILIKE treats %, _ and \ as wildcards, so a search for "100%" must not
    # match every row — the term is escaped before it reaches the pattern.
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def clamp_limit(limit: int | None) -> int:
    # Clamped so a caller cannot ask for an unbounded page. One row above the
    # page size is allowed deliberately: fetching PAGE + 1 and dropping the
    # last is how the caller learns whether an older page exists without a
    # COUNT. The default applies only when the param is absent — an explicit
    # limit=0 is a real (if odd) request and clamps to 1, exactly as the
    # reference's Math.max(1, Math.min(0, 26)) does.
    if limit is None:
        limit = PAGE_SIZE
    return max(1, min(limit, PAGE_SIZE + 1))


class PostgresTasksModel:
    """The tasks SQL, parameterised by the app's connection pool."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def list(self, filters: TaskListFilters) -> list[TaskRow]:
        where: list[str] = ["1 = 1"]
        params: list[Any] = []

        # LIKE wildcards in a search box are almost always a literal character
        # the user typed, not a pattern. Without escaping, a single `%` matches
        # every row and hides a real filtering bug.
        term = filters.search.strip()
        if term:
            pattern = f"%{escape_like(term)}%"
            where.append("(t.title ILIKE %s OR t.description ILIKE %s)")
            params.extend([pattern, pattern])

        # Keyset rather than OFFSET: OFFSET re-walks every skipped row, so
        # page 50 costs 50x page 1, and a row inserted mid-walk shifts the
        # window. The cursor is bound as text and cast in SQL rather than as
        # a timestamptz: the driver would otherwise try to parse it back into
        # a datetime, which turns a stale or hand-edited cursor into a
        # driver-level error instead of simply not matching a row.
        decoded = decode_cursor(filters.cursor)
        if decoded is not None:
            where.append("(t.updated_at, t.id) < (%s::text::timestamptz, %s)")
            params.extend([decoded.created_at, decoded.id])

        if filters.project_id is not None:
            where.append("t.project_id = %s")
            params.append(filters.project_id)
        if filters.status:
            where.append("t.status = %s")
            params.append(filters.status)
        if filters.assignee_id is not None:
            where.append("t.assignee_id = %s")
            params.append(filters.assignee_id)

        sql = f"""
            SELECT
                {TASK_PROJECTION_FIELDS},
                {TASK_UPDATED_AT_CURSOR_FIELD}
            {TASK_PROJECTION_FROM}
            WHERE {" AND ".join(where)}
            GROUP BY t.id, p.name, u.display_name, t.updated_at
            ORDER BY t.updated_at DESC, t.id DESC
            LIMIT %s
        """
        params.append(clamp_limit(filters.limit))

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    rows = (await (await cur.execute(sql, params)).fetchall()) or []
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch tasks.") from error

        # Derived here rather than in SQL so cursor packing has one
        # implementation, shared with the decoder this query reads a page back
        # with.
        return [
            TaskRow.model_validate(
                {**row, "cursorFor": encode_cursor(row["updatedAtRaw"], row["id"])}
            )
            for row in rows
        ]

    async def get(self, id: int) -> Task | None:
        sql = f"""
            SELECT
                {TASK_PROJECTION_FIELDS}
            {TASK_PROJECTION_FROM}
            WHERE t.id = %s
            GROUP BY t.id, p.name, u.display_name
        """

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    row = await (await cur.execute(sql, (id,))).fetchone()
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch the task.") from error

        return Task.model_validate(row) if row is not None else None

    async def list_by_project(
        self, project_id: int, filters: ProjectTaskFilters
    ) -> list[ProjectTaskRow]:
        where: list[str] = ["t.project_id = %s"]
        params: list[Any] = [project_id]

        if filters.status:
            where.append("t.status = %s")
            params.append(filters.status)

        # The board pages over `(created_at, id)`: the board is "newest first"
        # by when work appeared, not by when it last moved. Comparing the row
        # tuple in one predicate lets Postgres use tasks_project_created_id_idx
        # directly.
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

    async def list_by_assignee(self, assignee_id: int) -> list[Task]:
        sql = f"""
            SELECT
                {TASK_PROJECTION_FIELDS}
            {TASK_PROJECTION_FROM}
            WHERE t.assignee_id = %s
            GROUP BY t.id, p.name, u.display_name
            ORDER BY t.updated_at DESC, t.id DESC
        """

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    rows = (
                        await (await cur.execute(sql, (assignee_id,))).fetchall()
                    ) or []
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch the user's tasks.") from error

        return [Task.model_validate(row) for row in rows]

    async def list_comments(self, task_id: int) -> list[Comment]:
        sql = """
            SELECT
                c.id::int AS id,
                c.task_id::int AS "taskId",
                u.display_name AS "authorName",
                c.body,
                to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
            FROM comments c
            JOIN users u ON u.id = c.author_id
            WHERE c.task_id = %s
            ORDER BY c.created_at DESC, c.id DESC
            LIMIT %s
        """

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    rows = (
                        await (
                            await cur.execute(sql, (task_id, COMMENTS_PER_TASK))
                        ).fetchall()
                    ) or []
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch the task comments.") from error

        return [Comment.model_validate(row) for row in rows]

    async def count(self, filters: TaskListFilters) -> int:
        # The count shares the list's search and filter params; cursor/limit
        # are list-paging params and are simply not part of a count.
        where: list[str] = ["1 = 1"]
        params: list[Any] = []

        term = filters.search.strip()
        if term:
            pattern = f"%{escape_like(term)}%"
            where.append("(t.title ILIKE %s OR t.description ILIKE %s)")
            params.extend([pattern, pattern])

        if filters.project_id is not None:
            where.append("t.project_id = %s")
            params.append(filters.project_id)
        if filters.status:
            where.append("t.status = %s")
            params.append(filters.status)
        if filters.assignee_id is not None:
            where.append("t.assignee_id = %s")
            params.append(filters.assignee_id)

        sql = f"""
            SELECT COUNT(*)::int AS count
            FROM tasks t
            WHERE {" AND ".join(where)}
        """

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    row = await (await cur.execute(sql, params)).fetchone()
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to count tasks.") from error

        return (row or {}).get("count", 0)

    async def resolve_refs(
        self, project_id: int, assignee_id: int | None
    ) -> TaskRefErrors:
        errors = TaskRefErrors()

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    project = await (
                        await cur.execute(
                            "SELECT id::int FROM projects WHERE id = %s", (project_id,)
                        )
                    ).fetchone()

                    if project is None:
                        errors["projectId"] = ["That project no longer exists."]

                    if assignee_id is not None:
                        assignee = await (
                            await cur.execute(
                                "SELECT id::int FROM users WHERE id = %s",
                                (assignee_id,),
                            )
                        ).fetchone()

                        if assignee is None:
                            errors["assigneeId"] = ["That assignee no longer exists."]
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to resolve the task references.") from error

        return errors

    async def create(self, input: TaskCreateInput) -> int:
        sql = """
            INSERT INTO tasks (
                project_id, assignee_id, title, description, status, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, now(), now())
            RETURNING id::int AS id
        """
        params = (
            input.project_id,
            input.assignee_id,
            input.title,
            input.description,
            input.status,
        )

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    # spec/queries.md — the server sets `created_at` and
                    # `updated_at` explicitly and equal (now() is the
                    # transaction timestamp, so both calls in one statement
                    # return the same instant). RETURNING id so the client can
                    # go to the row that was just created.
                    row = await (await cur.execute(sql, params)).fetchone()
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to create the task.") from error

        return row["id"]

    async def update(self, id: int, input: TaskUpdateInput) -> str:
        # The assignee is checked first, mirroring the reference: a bad
        # assignee is a field error (the client can fix it), a missing task is
        # a 404, and the field error is the more actionable of the two to
        # report first.
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    if input.assignee_id is not None:
                        assignee = await (
                            await cur.execute(
                                "SELECT id::int FROM users WHERE id = %s",
                                (input.assignee_id,),
                            )
                        ).fetchone()

                        if assignee is None:
                            return TASK_UPDATE_ASSIGNEE_MISSING

                    # Read the row first so a missing task is reported before
                    # anything is written, exactly as the reference does.
                    existing = await (
                        await cur.execute(
                            "SELECT id::int FROM tasks WHERE id = %s", (id,)
                        )
                    ).fetchone()

                    if existing is None:
                        return TASK_UPDATE_MISSING

                    # spec/queries.md — `updated_at` is set in the statement,
                    # not by a DB default or an ORM side effect. RETURNING
                    # distinguishes "no such row" from "row updated" if the
                    # row is deleted between the read above and this write.
                    updated = await (
                        await cur.execute(
                            """
                        UPDATE tasks
                        SET
                            title = %s,
                            description = %s,
                            status = %s,
                            assignee_id = %s,
                            updated_at = now()
                        WHERE id = %s
                        RETURNING id
                        """,
                            (
                                input.title,
                                input.description,
                                input.status,
                                input.assignee_id,
                                id,
                            ),
                        )
                    ).fetchall()

                    if not updated:
                        return TASK_UPDATE_MISSING

                    return TASK_UPDATE_OK
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to update the task.") from error

        return TASK_UPDATE_MISSING

    async def remove(self, id: int) -> int | None:
        # Read the project first, because the contract redirects to its board
        # after a delete; a missing task is reported before anything is
        # written.
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    existing = await (
                        await cur.execute(
                            'SELECT project_id::int AS "projectId" FROM tasks WHERE id = %s',
                            (id,),
                        )
                    ).fetchone()

                    if existing is None:
                        return None

                    deleted = await (
                        await cur.execute(
                            "DELETE FROM tasks WHERE id = %s RETURNING id", (id,)
                        )
                    ).fetchall()

                    if not deleted:
                        return None

                    return existing["projectId"]
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to delete the task.") from error

        return None

    async def create_with_comment(self, input: WithCommentInput) -> tuple[str, int]:
        # The author is a FK like the assignee, so an id that matches no row
        # fails the insert. Checking first turns that into a field error rather
        # than a thrown Postgres error the user cannot act on.
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    author = await (
                        await cur.execute(
                            "SELECT id::int FROM users WHERE id = %s",
                            (input.comment_author_id,),
                        )
                    ).fetchone()

                    if author is None:
                        return ("author-missing", 0)

                    # One `pool.connection()` block is one transaction: the
                    # task insert and the comment insert either both commit or
                    # both roll back, which is what spec/queries.md means by
                    # "no partial state is ever observable".
                    row = await (
                        await cur.execute(
                            """
                        INSERT INTO tasks (
                            project_id, assignee_id, title, description, status, created_at, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, now(), now())
                        RETURNING id::int AS id
                        """,
                            (
                                input.project_id,
                                input.assignee_id,
                                input.title,
                                input.description,
                                input.status,
                            ),
                        )
                    ).fetchone()

                    # Inside the same transaction, so a failure here throws and
                    # the task insert above is rolled back with it.
                    await cur.execute(
                        """
                        INSERT INTO comments (task_id, author_id, body, created_at)
                        VALUES (%s, %s, %s, now())
                        """,
                        (row["id"], input.comment_author_id, input.comment_body),
                    )

                    return (TASK_UPDATE_OK, row["id"])
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to create the task.") from error

        return ("author-missing", 0)

    async def add_comment(self, task_id: int, body: str, author_id: int) -> str:
        # The task and the author are both foreign keys. Checking first turns
        # an unknown id into an outcome the client can act on, rather than a
        # thrown Postgres error.
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    task = await (
                        await cur.execute(
                            "SELECT id::int FROM tasks WHERE id = %s", (task_id,)
                        )
                    ).fetchone()
                    author = await (
                        await cur.execute(
                            "SELECT id::int FROM users WHERE id = %s", (author_id,)
                        )
                    ).fetchone()

                    if task is None:
                        return ADD_COMMENT_TASK_MISSING

                    if author is None:
                        return ADD_COMMENT_AUTHOR_MISSING

                    await cur.execute(
                        """
                        INSERT INTO comments (task_id, author_id, body, created_at)
                        VALUES (%s, %s, %s, now())
                        """,
                        (task_id, author_id, body),
                    )

                    return ADD_COMMENT_OK
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to add the comment.") from error

        return ADD_COMMENT_TASK_MISSING


def create_tasks_model(pool: AsyncConnectionPool) -> TasksModel:
    return PostgresTasksModel(pool)
