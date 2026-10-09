# src/db/migrate.py
#
# Applies the normative schema (spec/schema.sql) to the database named by
# POSTGRES_URL. Same file the test lifecycle applies, so dev and test
# databases can never drift apart.
#
#   python -m src.db.migrate

from psycopg2 import sql

from src.config.env import require_postgres_url
from src.db.connection import Db
from src.db.spec_dir import schema_path


def main() -> None:
    database = Db(require_postgres_url())

    try:
        schema = schema_path().read_text(encoding="utf-8")

        with database.transaction() as tx:
            # psycopg2 runs a multi-statement script in one PQexec, inside the
            # one transaction: a failure anywhere leaves no half-built schema.
            tx.query(sql.SQL(schema))

        print("Schema applied successfully")
    finally:
        database.close()


if __name__ == "__main__":
    main()
