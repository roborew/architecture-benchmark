"""tests/integration/conftest.py

Points the query layer at the isolated test database and guarantees it is
seeded, so integration tests assert against the same rows the e2e suite
will.

The Express suite wires this through a Vitest `setupFiles` entry
(tests/integration/database.ts), which Vitest re-runs for every test file —
each integration module starts from a freshly seeded database, so a module's
reads never observe an earlier module's writes. The pytest equivalent of that
granularity is an autouse module-scoped fixture: reset and seed once per
test module, and the suite's ordering strategy (reads before writes, one
file self-contained) carries over unchanged.

The guard runs at conftest import time, before any test module imports the
app — the pytest counterpart of a setupFile running before the test files.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# The helpers and the app import as `tests.*` / `app.*` packages rooted at
# the app root (fastapi-rest/); make sure that root is importable however
# pytest was invoked.
_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from app.main import create_app
from tests.helpers.database import (
    E2E_DATABASE,
    assert_not_dev_database,
    e2e_connection_string,
    reset_database,
    seed_database,
)

CONNECTION_STRING = e2e_connection_string()

# Guard before anything connects: an integration test must never write to the
# developer's database.
assert_not_dev_database(CONNECTION_STRING)
os.environ["POSTGRES_URL"] = CONNECTION_STRING


@pytest.fixture(autouse=True, scope="module")
def seeded_database() -> None:
    """Reset and re-seed the isolated database once per integration module.

    Reset unconditionally rather than trusting a leftover database. Seeding is
    a handful of rows, so the cost is negligible and a stale row can never
    leak into an assertion.
    """
    reset_database()
    seed_database()

    print(f"[integration] seeded {E2E_DATABASE}")


@pytest.fixture(scope="module")
def client(seeded_database: None) -> Iterator[TestClient]:
    """The app under test, as a TestClient pointed at the isolated database.

    One app per module, held open for the module's duration: entering the
    TestClient runs the app's lifespan, which opens the pool, and leaving it
    closes the pool — so the pool lifecycle stays correct across every request
    the module makes (and the database is free to be reset before the next
    module).
    """
    app = create_app(CONNECTION_STRING)

    with TestClient(app) as test_client:
        yield test_client
