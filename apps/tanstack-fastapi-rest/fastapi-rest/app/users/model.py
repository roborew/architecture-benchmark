# app/users/model.py
#
# The model layer for users: the only place that knows the users SQL.
# Mirrors the reference variant's reads (apps/tanstack-start-react/src/lib/
# data.ts — getUsers, getUser, getUserTasks) and writes (actions.ts —
# createUser, updateUser, deleteUser) statement for statement, so both apps
# return identical rows and make identical changes for the same database.
#
# The counts are correlated subqueries, not LEFT JOIN aggregates: joining
# tasks x comments multiplies rows, and a COUNT(DISTINCT) over that product
# costs each member's tasks x comments — on the large fixture ~40M rows per
# request, enough to stall every page that renders a member select. Each
# subquery walks one index (tasks_assignee_id_idx, comments_author_id_idx),
# so the cost stays linear in the members listed, not in the data.

from __future__ import annotations

import logging
from typing import Protocol

from psycopg_pool import AsyncConnectionPool

from app.lib.task_projection import (
    TASK_PROJECTION_FIELDS,
    TASK_PROJECTION_FROM,
)
from app.tasks.schemas import Task

from .schemas import User

logger = logging.getLogger("fastapi-rest")

USER_UPDATE_OK = "ok"
USER_UPDATE_MISSING = "missing"
USER_DELETE_OK = "ok"
USER_DELETE_MISSING = "missing"
USER_DELETE_RESTRICTED = "restricted"


class UserCreateInput:
    __slots__ = ("name", "email")

    def __init__(self, *, name: str, email: str) -> None:
        self.name = name
        self.email = email


class UsersModel(Protocol):
    """The users surface's data contract, as the controller sees it."""

    async def list(self, term: str) -> list[User]: ...

    async def get(self, id: int) -> User | None: ...

    async def list_tasks(self, assignee_id: int) -> list[Task]: ...

    async def create(self, input: UserCreateInput) -> int: ...

    async def update(self, id: int, input: UserCreateInput) -> str: ...

    async def remove(self, id: int) -> tuple[str, str]: ...


def escape_like(term: str) -> str:
    # ILIKE treats %, _ and \ as wildcards, so a search for "100%" must not
    # match every row — the term is escaped before it reaches the pattern.
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# The aggregate projection: the columns every member read returns.
_USER_AGGREGATES = """
    SELECT
      u.id::int AS id,
      u.display_name AS name,
      u.email,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id)::int AS "assignedTaskCount",
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status <> 'done')::int AS "openTaskCount",
      (SELECT COUNT(*) FROM comments c WHERE c.author_id = u.id)::int AS "commentCount"
    FROM users u
"""

# The task rows a member's page renders, via the shared task projection
# (app/lib/task_projection.py), so a member's task cannot drift from the
# workspace list's row for the same task.


class PostgresUsersModel:
    """The users SQL, parameterised by the app's connection pool."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def list(self, term: str) -> list[User]:
        where = ""
        params: list[object] = []

        if term:
            pattern = f"%{escape_like(term)}%"
            where = "WHERE u.display_name ILIKE %s OR u.email ILIKE %s"
            params = [pattern, pattern]

        sql = f"""
            {_USER_AGGREGATES}
            {where}
            ORDER BY u.display_name DESC, u.id DESC
        """

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    rows = (await (await cur.execute(sql, params)).fetchall()) or []
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch users.") from error

        return [User.model_validate(row) for row in rows]

    async def get(self, id: int) -> User | None:
        sql = f"""
            {_USER_AGGREGATES}
            WHERE u.id = %s
        """

        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    row = await (await cur.execute(sql, (id,))).fetchone()
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to fetch the user.") from error

        return User.model_validate(row) if row is not None else None

    async def list_tasks(self, assignee_id: int) -> list[Task]:
        # Scoped by `assignee_id` rather than a name: two members can share a
        # display name, and a name filter would hand each of them the other's
        # work.
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

    async def create(self, input: UserCreateInput) -> int:
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    # RETURNING id so the client can go to the row that was
                    # just created (the contract redirects a create to the
                    # new member's page).
                    row = await (
                        await cur.execute(
                            """
                        INSERT INTO users (display_name, email)
                        VALUES (%s, %s)
                        RETURNING id::int AS id
                        """,
                            (input.name, input.email),
                        )
                    ).fetchone()
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to create the user.") from error

        return row["id"]

    async def update(self, id: int, input: UserCreateInput) -> str:
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    # RETURNING distinguishes "no such row" from "row updated",
                    # so a stale form cannot report success for a member who
                    # is already gone.
                    updated = await (
                        await cur.execute(
                            """
                        UPDATE users
                        SET display_name = %s, email = %s
                        WHERE id = %s
                        RETURNING id
                        """,
                            (input.name, input.email, id),
                        )
                    ).fetchall()

                    if not updated:
                        return USER_UPDATE_MISSING

                    return USER_UPDATE_OK
        except Exception as error:
            logger.exception("Database Error:")
            raise RuntimeError("Failed to update the user.") from error

        return USER_UPDATE_MISSING

    async def remove(self, id: int) -> tuple[str, str]:
        try:
            async with self._pool.connection() as conn:
                async with conn.cursor() as cur:
                    deleted = await (
                        await cur.execute(
                            "DELETE FROM users WHERE id = %s RETURNING id", (id,)
                        )
                    ).fetchall()

                    if not deleted:
                        return (USER_DELETE_MISSING, "")

                    return (USER_DELETE_OK, "")
        except Exception as error:
            # comments.author_id is ON DELETE RESTRICT, so a member who has
            # written anything cannot be removed. tasks.assignee_id is ON
            # DELETE SET NULL, which unassigns rather than blocking, so only
            # comments stop a delete. psycopg maps the two SQLSTATEs to
            # RestrictViolation / ForeignKeyViolation; both mean the same
            # thing here. This is a rule the user can act on, so it is
            # reported rather than raised — on a fresh connection block, since
            # the failed one's transaction is aborted.
            from psycopg.errors import ForeignKeyViolation, RestrictViolation

            if isinstance(error, (RestrictViolation, ForeignKeyViolation)):
                comment_count, task_count = await self._count_references(id)
                return (
                    USER_DELETE_RESTRICTED,
                    _restriction_message(comment_count, task_count),
                )

            logger.exception("Database Error:")
            raise RuntimeError("Failed to delete the user.") from error

    async def _count_references(self, id: int) -> tuple[int, int]:
        # The counts are named separately because the two FKs mean different
        # things, and only one of them is what blocks the delete:
        #   comments.author_id  ON DELETE RESTRICT — the delete is refused,
        #                                         and this is why
        #   tasks.assignee_id   ON DELETE SET NULL  — the delete succeeds and
        #                                         the tasks become unassigned
        # Naming both makes the message actionable: the reader learns which
        # rows to deal with, and that the task count is context rather than a
        # second blocker.
        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                comments = await (
                    await cur.execute(
                        "SELECT COUNT(*)::int AS count FROM comments WHERE author_id = %s",
                        (id,),
                    )
                ).fetchone()
                tasks = await (
                    await cur.execute(
                        "SELECT COUNT(*)::int AS count FROM tasks WHERE assignee_id = %s",
                        (id,),
                    )
                ).fetchone()

        return ((comments or {}).get("count", 0), (tasks or {}).get("count", 0))


def _restriction_message(comment_count: int, task_count: int) -> str:
    comment = "comment" if comment_count == 1 else "comments"
    task = "task" if task_count == 1 else "tasks"
    them = "the comment" if comment_count == 1 else "the comments"
    return (
        f"This person still has {comment_count} {comment} and "
        f"{task_count} {task}. Remove {them} before deleting."
    )


def create_users_model(pool: AsyncConnectionPool) -> UsersModel:
    return PostgresUsersModel(pool)
