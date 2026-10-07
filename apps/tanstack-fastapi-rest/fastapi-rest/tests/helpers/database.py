"""tests/helpers/database.py

Lifecycle for the isolated test database.

The integration suite runs against its OWN database —
`architecture_tanstack_fastapi_rest_e2e` on the same Postgres server —
created, migrated, seeded and dropped around the run. The developer's
database is never read or written, so a failing (or mutating) test run
cannot disturb local work, and dev data changes cannot break the suite.

The dataset is `spec/snapshots/correctness/*.csv`, the fixture every app
variant in this repo shares.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from psycopg import Connection

from app.db.spec_dir import schema_path
from tests.fixtures.load import FIXTURE_TABLES, fixture_directory

E2E_DATABASE = "architecture_tanstack_fastapi_rest_e2e"

# The app root (fastapi-rest/), where the developer's `.env` lives.
_APP_ROOT = Path(__file__).resolve().parents[2]


def _read_env_file(path: Path) -> dict[str, str]:
    """The `.env` file's `KEY=value` pairs, parsed simply."""
    values: dict[str, str] = {}

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")

    return values


def _with_database(base: str, database: str) -> str:
    """Swap only the database name of a URL, so the result lives on the same
    server with the same credentials as the original."""
    parts = urlsplit(base)
    return urlunsplit(parts._replace(path=f"/{database}"))


def e2e_connection_string() -> str:
    """Connection string for the test database.

    Derived from the developer's `POSTGRES_URL` by swapping only the database
    name, so both live on the same server and the same credentials apply. Falls
    back to reading `.env` from the app root when the variable is not exported.
    """
    env_path = _APP_ROOT / ".env"

    if not os.environ.get("POSTGRES_URL") and env_path.exists():
        # Node's process.loadEnvFile() never overrides exported variables.
        for key, value in _read_env_file(env_path).items():
            os.environ.setdefault(key, value)

    base = os.environ.get("POSTGRES_URL")

    if not base:
        raise RuntimeError(
            "Missing POSTGRES_URL: set it in .env so the test database can be created.",
        )

    return _with_database(base, E2E_DATABASE)


def _admin_connection_string() -> str:
    """Connection string for the maintenance database, used to CREATE/DROP
    DATABASE."""
    return _with_database(e2e_connection_string(), "postgres")


def reset_database() -> None:
    """Drop and recreate the test database, then apply the schema.

    DROP rather than TRUNCATE so a previous run's schema can never leak through —
    the app is under active migration and a stale column would be a confusing
    failure. `FORCE` also terminates stragglers if a previous dev server is
    still connected.
    """
    # CREATE/DROP DATABASE cannot run inside a transaction block, so the
    # maintenance connection is autocommit.
    with Connection.connect(_admin_connection_string(), autocommit=True) as admin:
        admin.execute(f"drop database if exists {E2E_DATABASE} with (force)")
        admin.execute(f"create database {E2E_DATABASE}")

    with Connection.connect(e2e_connection_string()) as conn:
        conn.execute(schema_path.read_text(encoding="utf-8"))
        conn.commit()


def seed_database() -> None:
    """Load the shared fixture into the test database."""
    with Connection.connect(e2e_connection_string()) as conn:
        with conn.transaction():
            # `COPY ... FROM STDIN` streams the fixture CSVs straight in — the
            # same path app/db/seed.py uses for the dev database, so the two
            # seeders cannot diverge in behaviour. The fixture header rows
            # already match the schema column names exactly, which is the
            # contract spec/seed-spec.md relies on.
            for table in FIXTURE_TABLES:
                data = (fixture_directory / f"{table}.csv").read_text(encoding="utf-8")

                with conn.cursor() as cur:
                    with cur.copy(
                        f"COPY {table} FROM STDIN WITH (format csv, header true)"
                    ) as cp:
                        cp.write(data)

            # The fixture carries explicit ids, which bypass the identity
            # sequences. Advance them past the loaded rows or the next live
            # insert collides.
            for table in FIXTURE_TABLES:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT setval("
                        "pg_get_serial_sequence(%s, 'id'), "
                        f"coalesce((SELECT max(id) FROM {table}), 1))",
                        (table,),
                    )


def drop_database() -> None:
    """Remove the test database entirely. Best-effort: never fails the run."""
    try:
        with Connection.connect(_admin_connection_string(), autocommit=True) as admin:
            admin.execute(f"drop database if exists {E2E_DATABASE} with (force)")
    except Exception as error:
        print(f"[test] could not drop {E2E_DATABASE}: {error}", file=sys.stderr)


def assert_not_dev_database(connection_string: str) -> None:
    """Guard used by tests to assert the app is reading the isolated database."""
    if E2E_DATABASE not in connection_string:
        raise RuntimeError(
            f"Refusing to run: POSTGRES_URL does not point at {E2E_DATABASE}. "
            f"Got {connection_string}. "
            "The test suite must never touch the dev database."
        )
