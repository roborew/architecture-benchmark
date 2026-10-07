# src/db/connection.py
#
# The Postgres gateway — the one module that knows psycopg2. Models receive a
# ``Db`` from the composition root and stay ignorant of the driver, exactly as
# the express variant's models receive a postgres.js ``Sql`` instance.
#
# Connections come from a small thread-safe pool, created lazily on the first
# query: building the app must not reach the network (the healthz integration
# test builds an app whose connection string is deliberately broken, and the
# endpoint must still answer). Plain reads and single-statement writes run
# with autocommit — one statement is one transaction, as postgres.js commits
# them — and ``transaction()`` is the explicit multi-statement unit
# create-with-comment needs.
#
# Rows come back as plain dicts keyed by the SQL column aliases ("projectId",
# "updatedAtRaw", ...), so a model's SELECT *is* the JSON payload, like the
# reference variant's rows.

import logging
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.sql import Composable

logger = logging.getLogger(__name__)

#: Query parameters: named (``%(name)s``) or positional, as psycopg2 accepts.
Params = Mapping[str, Any] | Sequence[Any]


def _fetch_rows(cursor) -> list[dict[str, Any]]:
    """Reads a finished statement's rows; DDL returns no rows."""
    if cursor.description is None:
        return []
    return [dict(row) for row in cursor.fetchall()]


class Transaction:
    """The handle a ``with db.transaction()`` block runs its statements
    through. Same query surface as ``Db``, one connection, one commit."""

    def __init__(self, conn) -> None:
        self._conn = conn

    def query(self, statement: Composable, params: Params = ()) -> list[dict[str, Any]]:
        with self._conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(statement, params)
            return _fetch_rows(cursor)

    def copy_from_stdin(self, statement: str, file) -> None:
        """Streams a file into an open ``COPY ... FROM STDIN``."""
        with self._conn.cursor() as cursor:
            cursor.copy_expert(statement, file)


class Db:
    """The pooled Postgres gateway the models are composed with."""

    def __init__(self, conninfo: str) -> None:
        self._conninfo = conninfo
        self._pool: ThreadedConnectionPool | None = None

    def _pool_instance(self) -> ThreadedConnectionPool:
        # minconn=0: nothing connects until the first checkout, so creating
        # the app (or building one per test) is free of network side effects.
        if self._pool is None:
            self._pool = ThreadedConnectionPool(0, 10, self._conninfo)
        return self._pool

    def query(self, statement: Composable, params: Params = ()) -> list[dict[str, Any]]:
        """Runs one statement with autocommit and returns its rows."""
        pool = self._pool_instance()
        conn = pool.getconn()
        conn.autocommit = True
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(statement, params)
                return _fetch_rows(cursor)
        finally:
            # The pool rolls back and retires a connection left in a bad state.
            pool.putconn(conn)

    @contextmanager
    def transaction(self) -> Iterator[Transaction]:
        """One transaction: every statement inside commits together, and any
        raise rolls all of them back — the unit spec/queries.md means by "no
        partial state is ever observable"."""
        pool = self._pool_instance()
        conn = pool.getconn()
        conn.autocommit = False
        try:
            tx = Transaction(conn)
            yield tx
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.autocommit = True
            pool.putconn(conn)

    def close(self) -> None:
        """Closes every pooled connection (scripts call this on the way out)."""
        if self._pool is not None:
            self._pool.closeall()
            self._pool = None


def escape_like(term: str) -> str:
    """Escapes ILIKE's wildcards, so a search for "100%" is literal.

    %, _ and \\ are wildcards to ILIKE; without escaping, a single ``%``
    matches every row and hides a real filtering bug. Shared by every model
    that searches — the reference variant spells this same escape in each of
    its data modules.
    """
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
