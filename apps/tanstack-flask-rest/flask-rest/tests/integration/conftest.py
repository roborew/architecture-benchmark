# tests/integration/conftest.py
#
# Lifecycle for the isolated test database, mirroring the express variant's
# tests/helpers/database.ts.
#
# The integration suite runs against its OWN database —
# `architecture_tanstack_flask_rest_e2e` on the same Postgres server —
# created, migrated, seeded and dropped around the run. The developer's
# database is never read or written, so a failing (or mutating) test run
# cannot disturb local work, and dev data changes cannot break the suite.
#
# The dataset is `spec/snapshots/correctness/*.csv`, the fixture every app
# variant in this repo shares. The database is created once for the run and
# re-seeded before every module, mirroring the express variant's vitest
# setupFiles which re-seed once per test FILE in its isolated worker — so the
# order files run in cannot matter.

import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg2
import pytest
from psycopg2 import sql
from psycopg2.pool import ThreadedConnectionPool

from src.app import create_app
from src.config import env as app_env
from src.db.spec_dir import schema_path, snapshots_directory

E2E_DATABASE = "architecture_tanstack_flask_rest_e2e"

#: Fixture profile the app's test tiers assert against.
FIXTURE_PROFILE = "correctness"

#: Fixture table names in foreign-key-safe insertion order.
FIXTURE_TABLES = ("users", "projects", "tasks", "comments")


def _base_connection_string() -> str:
    # Falls back to reading `.env` from the app root when the variable is not
    # exported — the same resolution src/config/env.py performs.
    url = os.environ.get("POSTGRES_URL", "") or app_env.POSTGRES_URL

    if not url:
        raise RuntimeError(
            "Missing POSTGRES_URL: set it in .env so the test database can be created."
        )

    return url


def _with_database(base: str, database: str) -> str:
    parts = urlsplit(base)
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", parts.query, ""))


def e2e_connection_string() -> str:
    """Connection string for the test database: the developer's URL with only
    the database name swapped, so both live on the same server and the same
    credentials apply."""
    return _with_database(_base_connection_string(), E2E_DATABASE)


def _admin_connection_string() -> str:
    return _with_database(_base_connection_string(), "postgres")


def reset_database() -> None:
    """Drop and recreate the test database, then apply the schema.

    DROP rather than TRUNCATE so a previous run's schema can never leak
    through. `FORCE` also terminates stragglers if a previous dev server is
    still connected.
    """
    admin = psycopg2.connect(_admin_connection_string())
    admin.autocommit = True
    try:
        with admin.cursor() as cursor:
            cursor.execute(f"DROP DATABASE IF EXISTS {E2E_DATABASE} WITH (FORCE)")
            cursor.execute(f"CREATE DATABASE {E2E_DATABASE}")
    finally:
        admin.close()

    database = psycopg2.connect(e2e_connection_string())
    try:
        with database.cursor() as cursor:
            cursor.execute(schema_path().read_text(encoding="utf-8"))
        database.commit()
    finally:
        database.close()


def seed_database() -> None:
    """(Re)loads the shared fixture into the test database via COPY — the
    same path src/db/seed.py uses for the dev database, so the two seeders
    cannot diverge in behaviour.

    Truncating first makes the load idempotent: each test module starts from
    the canonical fixture, mirroring the express variant's vitest setupFiles
    which re-seed once per test FILE in its isolated worker."""
    fixture_directory = snapshots_directory() / FIXTURE_PROFILE
    pool = ThreadedConnectionPool(1, 1, e2e_connection_string())
    conn = pool.getconn()
    conn.autocommit = False
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "TRUNCATE TABLE comments, tasks, projects, users "
                "RESTART IDENTITY CASCADE"
            )

            for table in FIXTURE_TABLES:
                statement = f"COPY {table} FROM STDIN WITH (format csv, header true)"
                with (fixture_directory / f"{table}.csv").open("rb") as stream:
                    cursor.copy_expert(statement, stream)

            # The fixture carries explicit ids, which bypass the identity
            # sequences. Advance them past the loaded rows or the next live
            # insert collides.
            for table in FIXTURE_TABLES:
                cursor.execute(
                    sql.SQL(
                        "SELECT setval("
                        "pg_get_serial_sequence(%(table)s, 'id'), "
                        "COALESCE((SELECT MAX(id) FROM {table}), 1))"
                    ).format(table=sql.Identifier(table)),
                    {"table": table},
                )

        conn.commit()
    finally:
        pool.putconn(conn)
        pool.closeall()


def drop_database() -> None:
    """Remove the test database entirely. Best-effort: never fails the run."""
    admin = psycopg2.connect(_admin_connection_string())
    admin.autocommit = True
    try:
        with admin.cursor() as cursor:
            cursor.execute(f"DROP DATABASE IF EXISTS {E2E_DATABASE} WITH (FORCE)")
    except psycopg2.Error as error:  # pragma: no cover - best-effort path
        print(f"[test] could not drop {E2E_DATABASE}: {error}")
    finally:
        admin.close()


@pytest.fixture(scope="session")
def e2e_url() -> str:
    """The isolated database: created and schema'd once for the whole run,
    dropped when it ends."""
    reset_database()
    try:
        yield e2e_connection_string()
    finally:
        drop_database()


@pytest.fixture(autouse=True, scope="module")
def fresh_fixture(e2e_url: str) -> None:
    """Every integration module starts from the canonical fixture.

    The express variant gets this from vitest's per-file worker isolation
    (its setupFiles re-seed once per file); pytest modules share a session,
    so the reseed is explicit — order between modules then cannot matter.
    """
    seed_database()


@pytest.fixture(scope="module")
def client(e2e_url: str):
    """A test client for a fully-wired app pointed at the isolated database."""
    application = create_app(postgres_url=e2e_url)
    with application.test_client() as test_client:
        yield test_client
