# src/db/connection.py
#
# The Postgres gateway — the one module that knows psycopg2. Models receive a
# ``Db`` from the composition root and stay ignorant of the driver, exactly as
# the express variant's models receive a postgres.js ``Sql`` instance.
#
# Connections come from a small pool that BLOCKS when every connection is busy
# — the semantics postgres.js gives the express variant (its default pool is
# 10, and it queues waiters). The SPA's TanStack Query layer fires bursts of
# parallel fetches; a pool that refused waiters would answer 500s mid-listing
# (the e2e browser suite caught exactly that), so a request that arrives while
# the pool is drained waits for a check-in instead. The pool is created lazily
# on the first query: building the app must never reach the network (the
# healthz integration test builds an app whose connection string is
# deliberately broken, and the endpoint must still answer). Plain reads and
# single-statement writes run with autocommit — one statement is one
# transaction, as postgres.js commits them — and ``transaction()`` is the
# explicit multi-statement unit create-with-comment needs.
#
# Rows come back as plain dicts keyed by the SQL column aliases ("projectId",
# "updatedAtRaw", ...), so a model's SELECT *is* the JSON payload, like the
# reference variant's rows.

import logging
import threading
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

import psycopg2
from psycopg2.extensions import TRANSACTION_STATUS_IDLE
from psycopg2.extras import RealDictCursor
from psycopg2.sql import Composable

logger = logging.getLogger(__name__)

#: Query parameters: named (``%(name)s``) or positional, as psycopg2 accepts.
Params = Mapping[str, Any] | Sequence[Any]

#: How many connections the pool opens at most — postgres.js's default. A
#: burst larger than this queues on the condition variable rather than
#: erroring.
MAX_CONNECTIONS = 10


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

    def __init__(self, conninfo: str, max_connections: int = MAX_CONNECTIONS) -> None:
        self._conninfo = conninfo
        self._max = max_connections
        self._condition = threading.Condition()
        self._idle: list = []
        self._created = 0
        self._closed = False

    def _connect(self):
        """Checks a connection out, creating one while under the ceiling.

        A caller that arrives while every connection is busy waits here — a
        pool that refused waiters would fail the burst of parallel fetches the
        SPA's query layer fires. A connection dropped by the server is
        retired and replaced rather than handed out to fail mid-request.
        """
        while True:
            with self._condition:
                if self._closed:
                    raise RuntimeError("The database pool is closed.")

                if self._idle:
                    conn = self._idle.pop()
                    if conn.closed:
                        self._created -= 1
                        continue
                    return conn

                if self._created < self._max:
                    # Reserve the slot; connect outside the lock so a slow
                    # handshake never blocks the other threads.
                    self._created += 1
                    break

                self._condition.wait()

        try:
            return psycopg2.connect(self._conninfo)
        except BaseException:
            with self._condition:
                self._created -= 1
                self._condition.notify()
            raise

    def _release(self, conn) -> None:
        """Checks a connection back in — never a dirty or broken one."""
        with self._condition:
            healthy = not self._closed and conn.closed == 0

            if healthy and conn.info.transaction_status != TRANSACTION_STATUS_IDLE:
                try:
                    conn.rollback()
                except psycopg2.Error:
                    healthy = False

            if healthy:
                conn.autocommit = True
                self._idle.append(conn)
            else:
                self._created -= 1
                if conn.closed == 0:
                    conn.close()

            self._condition.notify()

    def query(self, statement: Composable, params: Params = ()) -> list[dict[str, Any]]:
        """Runs one statement with autocommit and returns its rows."""
        conn = self._connect()
        conn.autocommit = True
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(statement, params)
                return _fetch_rows(cursor)
        finally:
            self._release(conn)

    @contextmanager
    def transaction(self) -> Iterator[Transaction]:
        """One transaction: every statement inside commits together, and any
        raise rolls all of them back — the unit spec/queries.md means by "no
        partial state is ever observable"."""
        conn = self._connect()
        conn.autocommit = False
        try:
            tx = Transaction(conn)
            yield tx
            conn.commit()
        except BaseException:
            try:
                conn.rollback()
            except psycopg2.Error:
                pass  # a broken connection is retired by the release below
            raise
        finally:
            conn.autocommit = True
            self._release(conn)

    def close(self) -> None:
        """Closes the pool and its idle connections (scripts call this on the
        way out). A connection still checked out is retired when it is
        released."""
        with self._condition:
            self._closed = True
            idle, self._idle = self._idle, []
            self._condition.notify_all()

        for conn in idle:
            conn.close()


def escape_like(term: str) -> str:
    """Escapes ILIKE's wildcards, so a search for "100%" is literal.

    %, _ and \\ are wildcards to ILIKE; without escaping, a single ``%``
    matches every row and hides a real filtering bug. Shared by every model
    that searches — the reference variant spells this same escape in each of
    its data modules.
    """
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
