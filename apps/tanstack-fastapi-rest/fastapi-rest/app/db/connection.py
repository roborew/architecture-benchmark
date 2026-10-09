# app/db/connection.py
#
# The Postgres pool. psycopg's AsyncConnectionPool connects lazily — the
# instance is cheap to create and only reaches the server on the first
# `open()` — so building one per app (rather than a module singleton) keeps
# `create_app` self-contained and lets tests point the app at a database of
# their choosing. The pool is opened in the app's lifespan and closed on
# shutdown (app/main.py); models never open or close it.
#
# Every statement inside one `async with pool.connection()` block shares a
# single transaction: psycopg commits the block on clean exit and rolls it
# back on an error, which is the transaction boundary the Express variant's
# `db.begin` provides.

from __future__ import annotations

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

# Rows reach the models as plain dicts, keyed exactly as the SQL aliases spell
# them — the camelCase projection the response schemas are built from.
ConnectionPool = AsyncConnectionPool[dict]


def create_pool(conninfo: str) -> ConnectionPool:
    """A pool for one connection string, unopened.

    `open=False` keeps construction side-effect free (no event loop needed,
    no workers started), so `create_app` can be called from tests and from
    the factory uvicorn loads — the lifespan is the only place that opens it.
    """
    return AsyncConnectionPool(
        conninfo,
        open=False,
        min_size=1,
        max_size=10,
        kwargs={"row_factory": dict_row},
    )
