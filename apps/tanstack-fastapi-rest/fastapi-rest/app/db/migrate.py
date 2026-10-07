# app/db/migrate.py
#
# Applies the normative schema (spec/schema.sql) to the database named by
# POSTGRES_URL. Same file the test lifecycle applies, so dev and test
# databases can never drift apart.
#
# Run as a module:  python -m app.db.migrate

from __future__ import annotations

from psycopg import Connection

from app.config import require_postgres_url
from app.db.spec_dir import schema_path


def main() -> None:
    url = require_postgres_url()

    with Connection.connect(url) as conn:
        conn.execute(schema_path.read_text(encoding="utf-8"))
        conn.commit()

    print("Schema applied successfully")


if __name__ == "__main__":
    main()
