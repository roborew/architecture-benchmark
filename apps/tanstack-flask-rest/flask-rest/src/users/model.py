# src/users/users.model.py
#
# The model layer for users: the only place that knows the users SQL. Mirrors
# the reference variant's reads (apps/tanstack-start-react/src/lib/data.ts —
# getUsers, getUser, getUserTasks) and writes (actions.ts — createUser,
# updateUser, deleteUser) statement for statement, so both apps return
# identical rows and make identical changes for the same database.
#
# Every count is DISTINCT on its own side's key because the two LEFT JOINs
# multiply: a member with 2 tasks and 2 comments produces 4 rows, and a plain
# COUNT over that join would report 4 tasks.

import logging
from dataclasses import dataclass
from typing import Literal, Protocol, TypedDict

import psycopg2
from psycopg2.sql import SQL, Composable, Composed

from src.db.connection import Db, escape_like
from src.lib.task_projection import (
    TASK_PROJECTION_FIELDS,
    TASK_PROJECTION_FROM,
)

logger = logging.getLogger(__name__)


class User(TypedDict):
    id: int
    name: str
    email: str
    assignedTaskCount: int
    openTaskCount: int
    commentCount: int


@dataclass(frozen=True)
class UserCreateInput:
    name: str
    email: str


@dataclass(frozen=True)
class DeleteRestricted:
    """A delete the schema's FK guard refused; ``message`` is the reference's
    guard text, answered as a 409."""

    message: str


UserUpdateResult = Literal["ok", "missing"]
UserDeleteResult = Literal["ok", "missing"] | DeleteRestricted


class UsersModel(Protocol):
    """The users surface, as the controller sees it: SQL in, plain rows out."""

    def list(self, term: str) -> list[User]:
        """The workspace members with their aggregate counts, ordered by
        ``display_name DESC, id DESC``. An empty term returns every member."""
        ...

    def get(self, id: int) -> User | None:
        """One member by id, or None when no row matches. Returns the same
        shape ``list`` does so the list and the detail header cannot disagree
        about the aggregate counts."""
        ...

    def list_tasks(self, assignee_id: int) -> list[dict]:
        """The tasks assigned to one member, ordered ``updated_at DESC, id
        DESC``, with the shared task projection (src/lib/task_projection.py)."""
        ...

    def create(self, input: UserCreateInput) -> int:
        """Inserts one member and returns its id."""
        ...

    def update(self, id: int, input: UserCreateInput) -> UserUpdateResult:
        """Updates one member by primary key; ``missing`` when no such row."""
        ...

    def remove(self, id: int) -> UserDeleteResult:
        """Deletes one member. ``DeleteRestricted`` carries the reference's
        guard message: comments.author_id is ON DELETE RESTRICT, so a member
        who has written anything cannot be removed. tasks.assignee_id is ON
        DELETE SET NULL, which unassigns rather than blocking, so only
        comments stop a delete."""
        ...


# The aggregate projection, shared by list and get so the two cannot drift.
_USER_AGGREGATES = SQL(
    """
    SELECT
      u.id::int AS id,
      u.display_name AS name,
      u.email,
      COUNT(DISTINCT t.id)::int AS "assignedTaskCount",
      COUNT(DISTINCT t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
      COUNT(DISTINCT c.id)::int AS "commentCount"
    FROM users u
    LEFT JOIN tasks t ON u.id = t.assignee_id
    LEFT JOIN comments c ON u.id = c.author_id
    """
)


def _user_list_statement(term: str) -> Composable:
    """The aggregate SELECT with the search filter and ordering spliced in.

    ILIKE treats %, _ and \\ as wildcards, so a search for "100%" must not
    match every row — the term is escaped before it reaches the pattern.
    """
    where = (
        SQL(" WHERE u.display_name ILIKE %(term)s OR u.email ILIKE %(term)s")
        if term
        else SQL("")
    )

    parts: list[Composable] = [
        _USER_AGGREGATES,
        where,
        SQL(
            " GROUP BY u.id, u.display_name, u.email ORDER BY u.display_name DESC, u.id DESC"
        ),
    ]
    return Composed(parts)


class PostgresUsersModel:
    """The users SQL against the composed ``Db``."""

    def __init__(self, db: Db) -> None:
        self._db = db

    def list(self, term: str) -> list[User]:
        params = {"term": f"%{escape_like(term)}%"} if term else {}
        try:
            return self._db.query(_user_list_statement(term), params)
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch users.") from error

    def get(self, id: int) -> User | None:
        try:
            rows = self._db.query(
                Composed(
                    [
                        _USER_AGGREGATES,
                        SQL(
                            " WHERE u.id = %(id)s GROUP BY u.id, u.display_name, u.email"
                        ),
                    ]
                ),
                {"id": id},
            )
            return rows[0] if rows else None
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to fetch the user.") from error

    def list_tasks(self, assignee_id: int) -> list[dict]:
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

    def create(self, input: UserCreateInput) -> int:
        try:
            # RETURNING id so the client can go to the row that was just
            # created (the contract redirects a create to the new member's
            # page).
            rows = self._db.query(
                SQL(
                    "INSERT INTO users (display_name, email)"
                    " VALUES (%(name)s, %(email)s)"
                    " RETURNING id::int AS id"
                ),
                {"name": input.name, "email": input.email},
            )
            return rows[0]["id"]
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to create the user.") from error

    def update(self, id: int, input: UserCreateInput) -> UserUpdateResult:
        try:
            # RETURNING distinguishes "no such row" from "row updated", so a
            # stale form cannot report success for a member who is already
            # gone.
            rows = self._db.query(
                SQL(
                    "UPDATE users SET display_name = %(name)s, email = %(email)s"
                    " WHERE id = %(id)s"
                    " RETURNING id"
                ),
                {"name": input.name, "email": input.email, "id": id},
            )

            if not rows:
                return "missing"

            return "ok"
        except psycopg2.Error as error:
            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to update the user.") from error

    def remove(self, id: int) -> UserDeleteResult:
        try:
            rows = self._db.query(
                SQL("DELETE FROM users WHERE id = %(id)s RETURNING id"),
                {"id": id},
            )

            if not rows:
                return "missing"

            return "ok"
        except psycopg2.Error as error:
            # comments.author_id is ON DELETE RESTRICT, so a member who has
            # written anything cannot be removed. tasks.assignee_id is ON
            # DELETE SET NULL, which unassigns rather than blocking, so only
            # comments stop a delete. 23001 is restrict_violation; 23503 is
            # what NO ACTION raises, and both mean the same thing here.
            if error.pgcode in ("23001", "23503"):
                comment_rows = self._db.query(
                    SQL(
                        "SELECT COUNT(*)::int AS count FROM comments WHERE author_id = %(id)s"
                    ),
                    {"id": id},
                )
                task_rows = self._db.query(
                    SQL(
                        "SELECT COUNT(*)::int AS count FROM tasks WHERE assignee_id = %(id)s"
                    ),
                    {"id": id},
                )

                comment_count = comment_rows[0]["count"] if comment_rows else 0
                task_count = task_rows[0]["count"] if task_rows else 0

                # The counts are named separately because the two FKs mean
                # different things, and only one of them is what blocks the
                # delete:
                #   comments.author_id  ON DELETE RESTRICT — the delete is
                #                                        refused, and this is why
                #   tasks.assignee_id   ON DELETE SET NULL  — the delete
                #                                        succeeds and the tasks
                #                                        become unassigned
                # Naming both makes the message actionable: the reader learns
                # which rows to deal with, and that the task count is context
                # rather than a second blocker.
                comment_word = "comment" if comment_count == 1 else "comments"
                task_word = "task" if task_count == 1 else "tasks"
                remove_word = "the comment" if comment_count == 1 else "the comments"
                return DeleteRestricted(
                    message=(
                        f"This person still has {comment_count} {comment_word} "
                        f"and {task_count} {task_word}. Remove {remove_word} "
                        "before deleting."
                    )
                )

            logger.error("Database Error: %s", error)
            raise RuntimeError("Failed to delete the user.") from error
